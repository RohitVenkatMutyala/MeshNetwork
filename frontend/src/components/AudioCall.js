import React, {
    useState,
    useEffect,
    useRef,
    useLayoutEffect, // Using LayoutEffect like Call.js for better DOM sync
    useCallback
} from 'react';
import { useAuth } from '../context/AuthContext';
import { useParams, useNavigate } from 'react-router-dom';
import { db } from '../firebaseConfig';
import {
    doc, onSnapshot, updateDoc, collection, addDoc, query,
    orderBy, serverTimestamp, deleteDoc, deleteField, arrayUnion
} from 'firebase/firestore';
import { toast } from 'react-toastify';
import Peer from 'simple-peer';
import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.css';
import emailjs from '@emailjs/browser';

// --- COMPONENT: RemoteAudioTile ---
// Mimics RemoteVideo but for Audio
const RemoteAudioTile = ({ peer, name }) => {
    const audioRef = useRef(null);
    const [isMuted, setIsMuted] = useState(false);
    const [isSpeaking, setIsSpeaking] = useState(false);

    // 1. Attach Stream (Same logic as Video)
    useEffect(() => {
        if (peer && peer.stream && audioRef.current) {
            audioRef.current.srcObject = peer.stream;

            const audioTracks = peer.stream.getAudioTracks();
            if (audioTracks.length > 0) {
                setIsMuted(!audioTracks[0].enabled);
                
                const track = audioTracks[0];
                const handleMute = () => setIsMuted(true);
                const handleUnmute = () => setIsMuted(false);
                
                track.addEventListener('mute', handleMute);
                track.addEventListener('unmute', handleUnmute);
                
                return () => {
                    track.removeEventListener('mute', handleMute);
                    track.removeEventListener('unmute', handleUnmute);
                };
            }
        }
    }, [peer, peer.stream]);

    // 2. Audio Activity Detection (Visualizer)
    useEffect(() => {
        if (!peer || !peer.stream) return;
        let audioContext, analyser, microphone, javascriptNode;
        try {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            analyser = audioContext.createAnalyser();
            microphone = audioContext.createMediaStreamSource(peer.stream);
            javascriptNode = audioContext.createScriptProcessor(2048, 1, 1);
            analyser.smoothingTimeConstant = 0.8;
            analyser.fftSize = 1024;
            microphone.connect(analyser);
            analyser.connect(javascriptNode);
            javascriptNode.connect(audioContext.destination);
            javascriptNode.onaudioprocess = () => {
                const array = new Uint8Array(analyser.frequencyBinCount);
                analyser.getByteFrequencyData(array);
                let values = 0;
                for (let i = 0; i < array.length; i++) values += array[i];
                const average = values / array.length;
                setIsSpeaking(average > 10);
            };
        } catch(e) { console.warn(e); }

        return () => {
            if(javascriptNode) javascriptNode.disconnect();
            if(analyser) analyser.disconnect();
            if(microphone) microphone.disconnect();
            if(audioContext && audioContext.state !== 'closed') audioContext.close();
        };
    }, [peer]);

    return (
        <div className={`audio-tile ${isSpeaking ? 'speaking' : ''}`}>
            {/* The Invisible Speaker */}
            <audio ref={audioRef} autoPlay playsInline controls={false} />
            
            <div className="audio-avatar">
                {name ? name.charAt(0).toUpperCase() : '?'}
            </div>
            <div className="audio-name">
                {isMuted ? <i className="bi bi-mic-mute-fill text-danger me-2"></i> : <i className="bi bi-mic-fill text-success me-2"></i>}
                {name || 'Unknown'}
            </div>
        </div>
    );
};

// --- COMPONENT: SlideToActionButton (Reused) ---
function SlideToActionButton({ onAction, text, iconClass, colorClass, actionType }) {
    const [isDragging, setIsDragging] = useState(false);
    const [sliderLeft, setSliderLeft] = useState(0);
    const containerRef = useRef(null);
    const getClientX = (e) => e.touches ? e.touches[0].clientX : e.clientX;

    const handleDragMove = (e) => {
        if (!isDragging || !containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        let newLeft = getClientX(e) - rect.left - 30;
        if (newLeft < 0) newLeft = 0;
        if (newLeft > rect.width - 60) newLeft = rect.width - 60;
        setSliderLeft(newLeft);
        if (newLeft >= rect.width - 65) {
            setIsDragging(false);
            onAction();
        }
    };

    return (
        <div 
            className="slider-container" ref={containerRef}
            onMouseMove={handleDragMove} onTouchMove={handleDragMove}
            onMouseUp={() => {setIsDragging(false); setSliderLeft(0);}}
            onTouchEnd={() => {setIsDragging(false); setSliderLeft(0);}}
        >
            <div 
                className={`slider-thumb ${colorClass}`} style={{ left: sliderLeft }}
                onMouseDown={() => setIsDragging(true)} onTouchStart={() => setIsDragging(true)}
            >
                <i className={`bi ${actionType === 'accept' ? 'bi-arrow-right' : 'bi-x-lg'}`}></i>
            </div>
            <div className="slider-text"><i className={`bi ${iconClass} me-2`}></i>{text}</div>
        </div>
    );
}

function AudioCall() {
    const { user, loading } = useAuth();
    const { callId } = useParams();
    const navigate = useNavigate();

    // --- Core State ---
    const [callState, setCallState] = useState('loading');
    const [callData, setCallData] = useState(null);
    const [callOwnerId, setCallOwnerId] = useState(null);
    const [stream, setStream] = useState(null);
    const [muteStatus, setMuteStatus] = useState({});
    
    // --- Participants State ---
    const [participants, setParticipants] = useState([]);
    const [waitingUsers, setWaitingUsers] = useState([]);
    const [remoteStreams, setRemoteStreams] = useState([]); // This stores { id, stream, userId }

    // --- UI State ---
    const [messages, setMessages] = useState([]);
    const [newMessage, setNewMessage] = useState('');
    const [isChatOpen, setIsChatOpen] = useState(false);
    const [isParticipantsOpen, setIsParticipantsOpen] = useState(false); // NEW: For Mobile
    const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
    const [inviteEmails, setInviteEmails] = useState('');
    const [isInviting, setIsInviting] = useState(false);
    const [areControlsVisible, setAreControlsVisible] = useState(true);

    // --- Refs ---
    const peersRef = useRef({});
    const chatEndRef = useRef(null);
    const participantsRef = useRef(participants);

    // Keep participants ref fresh
    useEffect(() => { participantsRef.current = participants; }, [participants]);

    // --- 1. Init & Firestore (Identical to Call.js) ---
    useEffect(() => {
        if (loading) return;
        if (!user) { navigate('/login'); return; }
        if (!callId) { setCallState('denied'); return; }

        const callDocRef = doc(db, 'calls', callId);

        // Heartbeat
        const intervalId = setInterval(() => {
            const amIActive = participantsRef.current.find(p => p.id === user._id);
            if (amIActive) {
                updateDoc(callDocRef, { [`activeParticipants.${user._id}.lastSeen`]: serverTimestamp() }).catch(() => {});
            }
        }, 30000);

        const unsubscribeCall = onSnapshot(callDocRef, (docSnap) => {
            if (!docSnap.exists()) { setCallState('denied'); return; }
            const data = docSnap.data();
            setCallData(data);
            setCallOwnerId(data.ownerId);

            const isOwner = data.ownerId === user._id;
            const isAllowed = (data.allowedEmails || []).includes(user.email) || isOwner;
            if (!isAllowed) { setCallState('denied'); return; }

            // Sync Lists
            const pMap = data.activeParticipants || {};
            setParticipants(Object.entries(pMap).map(([id, d]) => ({ id, name: d.name })));
            
            const wMap = data.waitingRoom || {};
            setWaitingUsers(Object.entries(wMap).map(([id, d]) => ({ id, name: d.name })));
            
            setMuteStatus(data.muteStatus || {});

            // Connection State Logic
            if (callState === 'loading') {
                const alreadyJoined = sessionStorage.getItem(`audio_joined_${callId}`) === 'true';
                if (alreadyJoined || pMap[user._id]) {
                    setCallState('active');
                } else if (isOwner) {
                    setCallState('joining');
                } else {
                    setCallState('waiting');
                    if (!wMap[user._id]) {
                        updateDoc(callDocRef, { [`waitingRoom.${user._id}`]: { name: `${user.firstname} ${user.lastname}` } });
                    }
                }
            } else if (callState === 'waiting' && pMap[user._id]) {
                setCallState('joining');
            }
        });

        const unsubscribeMessages = onSnapshot(query(collection(db, 'calls', callId, 'messages'), orderBy('timestamp')), 
            (snap) => setMessages(snap.docs.map(d => ({ id: d.id, ...d.data() }))));

        return () => {
            clearInterval(intervalId);
            if (user) {
                updateDoc(callDocRef, { 
                    [`activeParticipants.${user._id}`]: deleteField(),
                    [`waitingRoom.${user._id}`]: deleteField()
                }).catch(() => {});
            }
            if (stream) stream.getTracks().forEach(t => t.stop());
            Object.values(peersRef.current).forEach(p => p.destroy());
            unsubscribeCall();
            unsubscribeMessages();
        };
    }, [callId, user, loading, navigate]); // Removed callState to prevent loop

    // --- 2. Connection Logic (COPIED EXACTLY FROM Call.js) ---
    const participantIDs = JSON.stringify(participants.map(p => p.id).sort());

    useEffect(() => {
        if (!stream || callState !== 'active' || !user) return;

        const signalingColRef = collection(db, 'calls', callId, 'signaling');

        const addStreamToState = (uid, s) => {
            setRemoteStreams(prev => {
                if (prev.find(x => x.id === uid)) return prev;
                return [...prev, { id: uid, stream: s }];
            });
        };

        const removeStreamFromState = (uid) => {
            setRemoteStreams(prev => prev.filter(s => s.id !== uid));
        };

        const createPeer = (targetId) => {
            // Initiator
            if (peersRef.current[targetId]) return;
            console.log("Creating peer for", targetId);
            const p = new Peer({ initiator: true, trickle: false, stream });

            p.on('signal', signal => addDoc(signalingColRef, { recipientId: targetId, senderId: user._id, signal }));
            p.on('stream', remoteStream => addStreamToState(targetId, remoteStream));
            p.on('close', () => { removeStreamFromState(targetId); delete peersRef.current[targetId]; });
            p.on('error', (err) => { console.error("Peer error:", err); removeStreamFromState(targetId); });

            peersRef.current[targetId] = p;
        };

        const addPeer = (data) => {
            // Receiver
            if (peersRef.current[data.senderId]) {
                peersRef.current[data.senderId].signal(data.signal);
                return;
            }
            console.log("Accepting peer from", data.senderId);
            const p = new Peer({ initiator: false, trickle: false, stream });

            p.on('signal', signal => addDoc(signalingColRef, { recipientId: data.senderId, senderId: user._id, signal }));
            p.on('stream', remoteStream => addStreamToState(data.senderId, remoteStream));
            p.on('close', () => { removeStreamFromState(data.senderId); delete peersRef.current[data.senderId]; });
            p.on('error', (err) => { console.error("Peer error:", err); removeStreamFromState(data.senderId); });

            p.signal(data.signal);
            peersRef.current[data.senderId] = p;
        };

        // Mesh Connect
        participants.forEach(p => {
            if (p.id !== user._id && !peersRef.current[p.id]) {
                createPeer(p.id);
            }
        });

        // Cleanup
        Object.keys(peersRef.current).forEach(pid => {
            if (!participants.find(p => p.id === pid)) {
                peersRef.current[pid].destroy();
                delete peersRef.current[pid];
                removeStreamFromState(pid);
            }
        });

        const unsubSignal = onSnapshot(query(signalingColRef), (snap) => {
            snap.docChanges().forEach(change => {
                if (change.type === 'added') {
                    const data = change.doc.data();
                    if (data.recipientId === user._id) {
                        const existingPeer = peersRef.current[data.senderId];
                        
                        if (data.signal.type === 'offer') {
                            if (existingPeer) existingPeer.destroy();
                            if (participants.find(p => p.id === data.senderId)) addPeer(data);
                        } else if (existingPeer) {
                            existingPeer.signal(data.signal);
                        }
                        deleteDoc(change.doc.ref);
                    }
                }
            });
        });

        return () => unsubSignal();
    }, [stream, callState, user, callId, participantIDs]);

    // --- 3. Mute Handling ---
    useEffect(() => {
        if (!stream || !user || !stream.getAudioTracks().length) return;
        const isMuted = muteStatus[user._id] ?? false;
        stream.getAudioTracks()[0].enabled = !isMuted;
    }, [muteStatus, stream, user]);

    // --- 4. Actions ---
    const handleJoin = async () => {
        try {
            // Audio Only Stream
            const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            setStream(s);
            
            await updateDoc(doc(db, 'calls', callId), {
                [`activeParticipants.${user._id}`]: { name: `${user.firstname} ${user.lastname}`, lastSeen: serverTimestamp() },
                [`muteStatus.${user._id}`]: false,
                [`waitingRoom.${user._id}`]: deleteField()
            });
            
            sessionStorage.setItem(`audio_joined_${callId}`, 'true');
            setCallState('active');
        } catch (e) { toast.error("Mic access failed"); }
    };

    const handleHangUp = () => {
        if (stream) stream.getTracks().forEach(t => t.stop());
        setStream(null);
        if (user) updateDoc(doc(db, 'calls', callId), { [`activeParticipants.${user._id}`]: deleteField() });
        sessionStorage.removeItem(`audio_joined_${callId}`);
        navigate('/new-call');
    };

    const handleToggleMute = async () => {
        const current = muteStatus[user._id] ?? false;
        await updateDoc(doc(db, 'calls', callId), { [`muteStatus.${user._id}`]: !current });
    };

    const handleSendMsg = async (e) => {
        e.preventDefault();
        if(!newMessage.trim()) return;
        await addDoc(collection(db, 'calls', callId, 'messages'), {
            text: newMessage, senderName: `${user.firstname} ${user.lastname}`, senderId: user._id, timestamp: serverTimestamp()
        });
        setNewMessage('');
    };

    const handleAllowUser = async (uid, uname) => {
        await updateDoc(doc(db, 'calls', callId), {
            [`waitingRoom.${uid}`]: deleteField(),
            [`activeParticipants.${uid}`]: { name: uname, lastSeen: serverTimestamp() },
            [`muteStatus.${uid}`]: false
        });
    };

    const handleSendInvites = async (e) => {
        e.preventDefault();
        if(!inviteEmails) return;
        setIsInviting(true);
        const emails = inviteEmails.split(',').map(e => e.trim()).filter(e => e);
        try {
            await updateDoc(doc(db, 'calls', callId), { allowedEmails: arrayUnion(...emails) });
            // Simplified Email Send
            const serviceID = 'service_y8qops6'; 
            const templateID = 'template_apzjekq';
            const pubKey = 'Cd-NUUSJ5dW3GJMo0';
            for(const email of emails) {
                await emailjs.send(serviceID, templateID, {
                    from_name: `${user.firstname} ${user.lastname}`,
                    to_email: email,
                    session_description: 'Audio Call',
                    session_link: window.location.href
                }, pubKey);
            }
            toast.success("Invites sent");
            setIsInviteModalOpen(false);
            setInviteEmails('');
        } catch(e) { toast.error("Error sending invites"); }
        setIsInviting(false);
    };

    // --- RENDER ---

    if (callState === 'loading') return <div className="bg-dark text-white vh-100 d-flex align-items-center justify-content-center">Loading...</div>;
    if (callState === 'denied') return <div className="bg-dark text-white vh-100 d-flex align-items-center justify-content-center"><h3>Access Denied</h3></div>;
    if (callState === 'waiting') return <div className="bg-dark text-white vh-100 d-flex align-items-center justify-content-center"><h4>Waiting...</h4></div>;

    if (callState === 'joining') return (
        <div className="bg-dark text-white vh-100 d-flex flex-column align-items-center justify-content-center">
            <style jsx>{`
                .slider-container { position: relative; width: 300px; height: 60px; background: rgba(255,255,255,0.1); border-radius: 30px; display: flex; align-items: center; justify-content: center; overflow: hidden; border: 1px solid rgba(255,255,255,0.2); margin-bottom: 20px; user-select: none; }
                .slider-text-overlay { position: absolute; font-weight: 500; pointer-events: none; z-index: 1; }
                .slider-thumb { position: absolute; left: 0; width: 60px; height: 100%; border-radius: 30px; display: flex; align-items: center; justify-content: center; font-size: 1.5rem; color: white; cursor: grab; z-index: 2; transition: left 0.1s; }
                .accept-color { background: #28a745; } .decline-color { background: #dc3545; }
            `}</style>
            <h2 className="mb-4">{callData?.ownerName}</h2>
            <p className="text-secondary mb-5">Audio Call</p>
            <SlideToActionButton onAction={handleJoin} text="Slide to Join" iconClass="bi-mic-fill" colorClass="accept-color" actionType="accept" />
            <SlideToActionButton onAction={() => navigate('/new-call')} text="Slide to Decline" iconClass="bi-telephone-x" colorClass="decline-color" actionType="decline" />
        </div>
    );

    return (
        <div className="audio-page-container" onClick={() => { setIsChatOpen(false); setAreControlsVisible(!areControlsVisible); }}>
            <style jsx>{`
                :root { --bg-dark: #12121c; --bg-card: #1e1e2f; --text-main: #e0e0e0; }
                .audio-page-container { background-color: var(--bg-dark); height: 100dvh; display: flex; flex-direction: row; overflow: hidden; color: var(--text-main); position: relative; }
                
                /* Layout: Main Grid + Sidebar */
                .main-area { flex-grow: 1; display: flex; flex-direction: column; position: relative; height: 100%; }
                .audio-grid { flex-grow: 1; display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 2rem; padding: 2rem; overflow-y: auto; }
                
                .audio-tile { width: 180px; height: 180px; background-color: var(--bg-card); border-radius: 50%; display: flex; flex-direction: column; align-items: center; justify-content: center; border: 3px solid #3a3a5a; transition: all 0.2s; position: relative; }
                .audio-tile.speaking { border-color: #28a745; transform: scale(1.05); box-shadow: 0 0 20px rgba(40, 167, 69, 0.4); }
                .audio-avatar { font-size: 3.5rem; font-weight: 700; color: #fff; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; border-radius: 50%; }
                .audio-name { position: absolute; bottom: -40px; font-size: 1.1rem; font-weight: 500; display: flex; align-items: center; white-space: nowrap; }
                
                /* Sidebar (Desktop) */
                .desktop-sidebar { width: 350px; background: var(--bg-card); border-left: 1px solid #333; display: flex; flex-direction: column; height: 100%; z-index: 20; }
                .sidebar-header { padding: 1rem; border-bottom: 1px solid #333; font-weight: 600; display: flex; justify-content: space-between; align-items: center; }
                .sidebar-content { flex: 1; overflow-y: auto; padding: 1rem; }
                
                /* Controls */
                .controls-bar { height: 90px; background: rgba(0,0,0,0.6); backdrop-filter: blur(10px); display: flex; align-items: center; justify-content: center; gap: 1.5rem; width: 100%; transition: transform 0.3s; position: absolute; bottom: 0; z-index: 10; }
                .controls-bar.hidden { transform: translateY(100%); }
                .btn-ctrl { width: 55px; height: 55px; border-radius: 50%; border: none; font-size: 1.3rem; transition: 0.2s; color: white; cursor: pointer; }
                .btn-ctrl:hover { transform: scale(1.1); }
                .btn-secondary { background: #3a3a5a; } .btn-danger { background: #dc3545; } .btn-primary { background: #0d6efd; }

                /* List Items */
                .participant-item { display: flex; justify-content: space-between; align-items: center; padding: 10px; border-bottom: 1px solid rgba(255,255,255,0.05); }
                
                /* Mobile Modal */
                .mobile-modal { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: var(--bg-dark); z-index: 50; display: flex; flex-direction: column; }
                .waiting-badge { position: absolute; top: 20px; left: 20px; background: rgba(255, 193, 7, 0.2); color: #ffc107; border: 1px solid #ffc107; padding: 8px 16px; border-radius: 20px; cursor: pointer; z-index: 5; font-weight: bold; animation: pulse 2s infinite; }
                @keyframes pulse { 0% { opacity: 0.7; } 50% { opacity: 1; } 100% { opacity: 0.7; } }
            `}</style>

            <div className="main-area">
                {/* Host Waiting Indicator */}
                {user._id === callOwnerId && waitingUsers.length > 0 && (
                    <div className="waiting-badge" onClick={(e) => { e.stopPropagation(); setIsInviteModalOpen(true); }}>
                        {waitingUsers.length} Waiting...
                    </div>
                )}

                {/* Main Audio Grid */}
                <div className="audio-grid" onClick={() => setIsChatOpen(false)}>
                    {/* Me */}
                    <div className={`audio-tile`} style={{ borderColor: muteStatus[user._id] ? '#dc3545' : '#3a3a5a' }}>
                        <div className="audio-avatar" style={{ backgroundColor: muteStatus[user._id] ? '#333' : '#28a745' }}>
                            {user.firstname.charAt(0).toUpperCase()}
                        </div>
                        <div className="audio-name">
                            You {muteStatus[user._id] && <i className="bi bi-mic-mute-fill text-danger ms-1"></i>}
                        </div>
                    </div>
                    {/* Others */}
                    {remoteStreams.map(rs => (
                        <RemoteAudioTile key={rs.id} peer={rs} name={participants.find(p => p.id === rs.id)?.name} />
                    ))}
                </div>

                {/* Controls */}
                <div className={`controls-bar ${!areControlsVisible ? 'hidden' : ''}`} onClick={e => e.stopPropagation()}>
                    <button className={`btn-ctrl ${muteStatus[user._id] ? 'btn-danger' : 'btn-secondary'}`} onClick={handleToggleMute}>
                        <i className={`bi ${muteStatus[user._id] ? 'bi-mic-mute-fill' : 'bi-mic-fill'}`}></i>
                    </button>
                    
                    {/* Show Sidebar Toggle (Mobile uses modal, Desktop uses sidebar) */}
                    <button className="btn-ctrl btn-primary d-md-none" onClick={() => setIsInviteModalOpen(true)}>
                        <i className="bi bi-people-fill"></i>
                    </button>

                    <button className={`btn-ctrl ${isChatOpen ? 'btn-primary' : 'btn-secondary'} d-md-none`} onClick={() => setIsChatOpen(!isChatOpen)}>
                        <i className="bi bi-chat-dots-fill"></i>
                    </button>

                    <button className="btn-ctrl btn-danger" onClick={handleHangUp} style={{width: 65, height: 65}}>
                        <i className="bi bi-telephone-x-fill" style={{ fontSize: '1.6rem' }}></i>
                    </button>
                </div>
            </div>

            {/* --- DESKTOP SIDEBAR (Participants & Chat) --- */}
            <div className="desktop-sidebar d-none d-md-flex">
                {/* 1. Waiting Room (Host) */}
                {user._id === callOwnerId && waitingUsers.length > 0 && (
                    <div className="p-3 border-bottom border-secondary bg-dark">
                        <h6 className="text-warning">Waiting Room</h6>
                        {waitingUsers.map(u => (
                            <div key={u.id} className="d-flex justify-content-between align-items-center mb-2">
                                <span>{u.name}</span>
                                <button className="btn btn-sm btn-success" onClick={() => handleAllowUser(u.id, u.name)}>Allow</button>
                            </div>
                        ))}
                    </div>
                )}

                {/* 2. Participants List */}
                <div className="p-3 border-bottom border-secondary" style={{maxHeight: '30%'}}>
                    <h6 className="text-muted mb-3">Participants ({participants.length})</h6>
                    <div style={{overflowY: 'auto', maxHeight: '200px'}}>
                        {participants.map(p => (
                            <div key={p.id} className="participant-item">
                                <span>{p.name} {p.id === user._id && '(You)'}</span>
                                {muteStatus[p.id] ? <i className="bi bi-mic-mute-fill text-danger"></i> : <i className="bi bi-mic-fill text-success"></i>}
                            </div>
                        ))}
                    </div>
                    {/* Invite Box */}
                    <div className="mt-3">
                        <small className="text-muted">Invite People</small>
                        <form onSubmit={handleSendInvites} className="d-flex gap-2 mt-1">
                            <input className="form-control form-control-sm bg-dark text-white border-secondary" placeholder="email..." value={inviteEmails} onChange={e=>setInviteEmails(e.target.value)} />
                            <button className="btn btn-sm btn-primary">{isInviting ? '...' : 'Send'}</button>
                        </form>
                    </div>
                </div>

                {/* 3. Chat */}
                <div className="d-flex flex-column flex-grow-1">
                    <div className="p-2 border-bottom border-secondary text-center fw-bold">Chat</div>
                    <div className="flex-grow-1 p-3 overflow-auto">
                        {messages.map(m => (
                            <div key={m.id} className="mb-2">
                                <small className="text-info fw-bold">{m.senderName}</small>
                                <div className="bg-secondary p-2 rounded mt-1 text-white" style={{fontSize:'0.9rem'}}>{m.text}</div>
                            </div>
                        ))}
                        <div ref={chatEndRef}></div>
                    </div>
                    <form onSubmit={handleSendMsg} className="p-2 border-top border-secondary d-flex gap-2">
                        <input className="form-control bg-dark text-white border-secondary" value={newMessage} onChange={e=>setNewMessage(e.target.value)} placeholder="Type..." />
                        <button className="btn btn-primary"><i className="bi bi-send-fill"></i></button>
                    </form>
                </div>
            </div>

            {/* --- MOBILE MODALS --- */}
            {/* Mobile Participants/Invite */}
            {isInviteModalOpen && (
                <div className="mobile-modal d-md-none">
                    <div className="p-3 border-bottom d-flex justify-content-between align-items-center bg-dark">
                        <h5 className="m-0">Participants</h5>
                        <button className="btn-close btn-close-white" onClick={() => setIsInviteModalOpen(false)}></button>
                    </div>
                    <div className="p-3 overflow-auto">
                        {/* Waiting */}
                        {user._id === callOwnerId && waitingUsers.length > 0 && (
                            <div className="mb-4">
                                <h6 className="text-warning">Waiting</h6>
                                {waitingUsers.map(u => (
                                    <div key={u.id} className="d-flex justify-content-between align-items-center mb-2">
                                        <span>{u.name}</span>
                                        <button className="btn btn-sm btn-success" onClick={() => handleAllowUser(u.id, u.name)}>Allow</button>
                                    </div>
                                ))}
                            </div>
                        )}
                        {/* List */}
                        <h6>In Call</h6>
                        {participants.map(p => (
                            <div key={p.id} className="participant-item">
                                <span>{p.name}</span>
                                {muteStatus[p.id] ? <i className="bi bi-mic-mute-fill text-danger"></i> : <i className="bi bi-mic-fill text-success"></i>}
                            </div>
                        ))}
                        {/* Invite */}
                        <h6 className="mt-4">Invite</h6>
                        <form onSubmit={handleSendInvites} className="d-flex gap-2 mt-2">
                            <input className="form-control bg-dark text-white border-secondary" placeholder="email..." value={inviteEmails} onChange={e=>setInviteEmails(e.target.value)} />
                            <button className="btn btn-primary">Send</button>
                        </form>
                    </div>
                </div>
            )}

            {/* Mobile Chat */}
            {isChatOpen && (
                <div className="mobile-modal d-md-none">
                    <div className="p-3 border-bottom d-flex justify-content-between align-items-center bg-dark">
                        <h5 className="m-0">Chat</h5>
                        <button className="btn-close btn-close-white" onClick={() => setIsChatOpen(false)}></button>
                    </div>
                    <div className="flex-grow-1 p-3 overflow-auto">
                        {messages.map(m => (
                            <div key={m.id} className="mb-2">
                                <small className="text-info fw-bold">{m.senderName}</small>
                                <div className="bg-secondary p-2 rounded mt-1 text-white">{m.text}</div>
                            </div>
                        ))}
                        <div ref={chatEndRef}></div>
                    </div>
                    <div className="p-2 border-top border-secondary">
                        <form onSubmit={handleSendMsg} className="d-flex gap-2">
                            <input className="form-control bg-dark text-white border-secondary" value={newMessage} onChange={e => setNewMessage(e.target.value)} placeholder="Type..." />
                            <button className="btn btn-primary"><i className="bi bi-send-fill"></i></button>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}

export default AudioCall;