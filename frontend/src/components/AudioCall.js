import React, {
    useState,
    useEffect,
    useRef,
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
// This acts like the "RemoteVideo" but for Audio.
// It renders an INVISIBLE <audio> tag so you can hear the person.
const RemoteAudioTile = ({ peer, name }) => {
    const audioRef = useRef(null);
    const [isMuted, setIsMuted] = useState(false);
    const [volumeLevel, setVolumeLevel] = useState(0); // For visual effect

    useEffect(() => {
        if (peer && peer.stream && audioRef.current) {
            // 1. IMPORTANT: Connect stream to the HTML Audio Element
            audioRef.current.srcObject = peer.stream;

            // 2. Detect Mute State from the stream track
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

    // 3. Optional: Visualizer logic (makes the avatar pulse when they talk)
    useEffect(() => {
        if (!peer?.stream) return;
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
                setVolumeLevel(average);
            };
        } catch (e) {
            console.warn("Audio visualizer setup failed", e);
        }

        return () => {
            if (javascriptNode) javascriptNode.disconnect();
            if (analyser) analyser.disconnect();
            if (microphone) microphone.disconnect();
            if (audioContext && audioContext.state !== 'closed') audioContext.close();
        };
    }, [peer]);

    // Calculate scale based on volume for "talking" effect
    const scale = 1 + (volumeLevel / 300); 

    return (
        <div className="audio-tile">
            {/* THE HIDDEN AUDIO PLAYER */}
            <audio ref={audioRef} autoPlay playsInline controls={false} />

            <div 
                className="audio-avatar" 
                style={{ 
                    transform: `scale(${Math.min(scale, 1.2)})`,
                    border: volumeLevel > 10 ? '3px solid #28a745' : '3px solid #3a3a5a'
                }}
            >
                {name ? name.charAt(0).toUpperCase() : '?'}
            </div>
            <div className="audio-name">
                {isMuted ? <i className="bi bi-mic-mute-fill text-danger me-2"></i> : <i className="bi bi-mic-fill text-success me-2"></i>}
                {name || 'Unknown'}
            </div>
        </div>
    );
};

// --- COMPONENT: Slider Button (Kept from your code) ---
function SlideToActionButton({ onAction, text, iconClass, colorClass, actionType }) {
    const [isDragging, setIsDragging] = useState(false);
    const [sliderLeft, setSliderLeft] = useState(0);
    const containerRef = useRef(null);
    const [completed, setCompleted] = useState(false);

    const getClientX = (e) => e.touches ? e.touches[0].clientX : e.clientX;

    const handleDragMove = (e) => {
        if (!isDragging || completed || !containerRef.current) return;
        const containerRect = containerRef.current.getBoundingClientRect();
        const startX = containerRect.left;
        const currentX = getClientX(e);
        let newLeft = currentX - startX - 30; // 30 is half thumb width
        
        const maxLeft = containerRect.width - 60 - 2; // width - thumb - border
        newLeft = Math.max(0, Math.min(newLeft, maxLeft));
        setSliderLeft(newLeft);

        if (newLeft > maxLeft * 0.9) {
            setCompleted(true);
            setIsDragging(false);
            setSliderLeft(maxLeft);
            onAction();
        }
    };

    const handleEnd = () => {
        if (!completed) {
            setIsDragging(false);
            setSliderLeft(0);
        }
    };

    return (
        <div 
            className="slider-container" 
            ref={containerRef} 
            onMouseMove={handleDragMove} 
            onTouchMove={handleDragMove} 
            onMouseUp={handleEnd} 
            onMouseLeave={handleEnd} 
            onTouchEnd={handleEnd}
        >
            <div 
                className={`slider-thumb ${colorClass}`} 
                style={{ left: `${sliderLeft}px` }} 
                onMouseDown={() => setIsDragging(true)} 
                onTouchStart={() => setIsDragging(true)}
            >
                <i className={`bi ${actionType === 'accept' ? 'bi-arrow-right' : 'bi-x-lg'}`}></i>
            </div>
            <div className="slider-text-overlay">
                <i className={`bi ${iconClass} me-2`}></i>{text}
            </div>
        </div>
    );
}

function AudioCall() {
    const { user, loading } = useAuth();
    const { callId } = useParams();
    const navigate = useNavigate();

    // --- State Variables ---
    const [callState, setCallState] = useState('loading');
    const [callData, setCallData] = useState(null);
    const [callOwnerId, setCallOwnerId] = useState(null);
    
    // Media & Connectivity
    const [stream, setStream] = useState(null);
    const [participants, setParticipants] = useState([]);
    const [waitingUsers, setWaitingUsers] = useState([]);
    const [remoteStreams, setRemoteStreams] = useState([]); 
    const [muteStatus, setMuteStatus] = useState({});
    
    // UI State
    const [messages, setMessages] = useState([]);
    const [newMessage, setNewMessage] = useState('');
    const [isChatOpen, setIsChatOpen] = useState(false);
    const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
    const [inviteEmails, setInviteEmails] = useState('');
    const [isInviting, setIsInviting] = useState(false);
    const [areControlsVisible, setAreControlsVisible] = useState(true);

    // Refs
    const peersRef = useRef({});
    const chatEndRef = useRef(null);
    const participantsRef = useRef(participants);

    useEffect(() => { participantsRef.current = participants; }, [participants]);

    // --- 1. Init: Check Auth & Load Call Data (Same as Call.js) ---
    useEffect(() => {
        if (loading) return;
        if (!user) { navigate('/login'); return; }
        if (!callId) { setCallState('denied'); return; }

        const callDocRef = doc(db, 'calls', callId);

        // Heartbeat
        const hb = setInterval(() => {
            const amIActive = participantsRef.current.find(p => p.id === user._id);
            if (amIActive) {
                updateDoc(callDocRef, { [`activeParticipants.${user._id}.lastSeen`]: serverTimestamp() }).catch(() => {});
            }
        }, 30000);

        const unsubCall = onSnapshot(callDocRef, (snap) => {
            if (!snap.exists()) { setCallState('denied'); return; }
            const data = snap.data();
            setCallData(data);
            setCallOwnerId(data.ownerId);

            const isOwner = user && data.ownerId === user._id;
            const hasAccess = (user && data.allowedEmails?.includes(user.email)) || isOwner;

            if (!hasAccess) { setCallState('denied'); return; }

            // Sync Participants
            const pMap = data.activeParticipants || {};
            setParticipants(Object.entries(pMap).map(([id, d]) => ({ id, name: d.name })));

            // Sync Waiting Room
            const wMap = data.waitingRoom || {};
            setWaitingUsers(Object.entries(wMap).map(([id, d]) => ({ id, name: d.name })));

            // Sync Mute Status
            setMuteStatus(data.muteStatus || {});

            // Initial Join Logic
            if (callState === 'loading') {
                const alreadyJoined = sessionStorage.getItem(`audio_call_joined_${callId}`) === 'true';
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
                setCallState('joining'); // Host allowed us in
            }
        });

        // Messages Listener
        const unsubMsg = onSnapshot(query(collection(db, 'calls', callId, 'messages'), orderBy('timestamp')), 
            snap => setMessages(snap.docs.map(d => ({ id: d.id, ...d.data() }))));

        return () => {
            clearInterval(hb);
            if (user) {
                // Optional: Leave on unmount logic here if desired
            }
            if (stream) stream.getTracks().forEach(t => t.stop());
            Object.values(peersRef.current).forEach(p => p.destroy());
            unsubCall();
            unsubMsg();
        };
    }, [callId, user, loading, navigate]);

    // --- 2. WebRTC Connection Logic (Exact copy of Call.js MESH Logic) ---
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

        // Initiator
        const createPeer = (targetId) => {
            if(peersRef.current[targetId]) return;
            const p = new Peer({ initiator: true, trickle: false, stream });
            
            p.on('signal', signal => addDoc(signalingColRef, { recipientId: targetId, senderId: user._id, signal }));
            p.on('stream', rs => addStreamToState(targetId, rs));
            p.on('close', () => {
                removeStreamFromState(targetId);
                delete peersRef.current[targetId];
            });
            peersRef.current[targetId] = p;
        };

        // Receiver
        const addPeer = (data) => {
            if(peersRef.current[data.senderId]) {
                // If peer exists, just signal (answer/candidate)
                peersRef.current[data.senderId].signal(data.signal);
                return;
            }
            const p = new Peer({ initiator: false, trickle: false, stream });
            
            p.on('signal', signal => addDoc(signalingColRef, { recipientId: data.senderId, senderId: user._id, signal }));
            p.on('stream', rs => addStreamToState(data.senderId, rs));
            p.signal(data.signal);
            peersRef.current[data.senderId] = p;
        };

        // Connect to existing participants
        participants.forEach(p => {
            if (p.id !== user._id && !peersRef.current[p.id]) {
                createPeer(p.id);
            }
        });

        // Cleanup stale peers
        Object.keys(peersRef.current).forEach(pid => {
            if (!participants.find(p => p.id === pid)) {
                if(peersRef.current[pid]) peersRef.current[pid].destroy();
                delete peersRef.current[pid];
                removeStreamFromState(pid);
            }
        });

        // Signaling Listener
        const unsubSignal = onSnapshot(query(signalingColRef), snapshot => {
            snapshot.docChanges().forEach(change => {
                const data = change.doc.data();
                if (change.type === "added" && data.recipientId === user._id) {
                    const existingPeer = peersRef.current[data.senderId];
                    
                    if (data.signal.type === 'offer') {
                        // If new offer, destroy old and accept new (Refresh logic)
                        if (existingPeer) existingPeer.destroy();
                        if (participants.find(p => p.id === data.senderId)) addPeer(data);
                    } else if (existingPeer) {
                        existingPeer.signal(data.signal);
                    }
                    deleteDoc(change.doc.ref);
                }
            });
        });

        return () => unsubSignal();
    }, [stream, callState, user, callId, participantIDs]);

    // --- 3. Mute Handling (Syncs with Firestore) ---
    useEffect(() => {
        if (!stream || !user || !stream.getAudioTracks().length) return;
        const isMuted = muteStatus[user._id] ?? false;
        stream.getAudioTracks()[0].enabled = !isMuted;
    }, [muteStatus, stream, user]);


    // --- 4. Actions ---

    // Join the call (Get User Media)
    const handleJoin = async () => {
        try {
            // Audio ONLY
            const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            setStream(s);

            await updateDoc(doc(db, 'calls', callId), {
                [`activeParticipants.${user._id}`]: { name: `${user.firstname} ${user.lastname}`, lastSeen: serverTimestamp() },
                [`waitingRoom.${user._id}`]: deleteField(),
                [`muteStatus.${user._id}`]: false
            });

            setCallState('active');
            sessionStorage.setItem(`audio_call_joined_${callId}`, 'true');
        } catch (err) {
            console.error(err);
            toast.error("Microphone access denied.");
        }
    };

    const handleHangUp = () => {
        if (stream) stream.getTracks().forEach(t => t.stop());
        setStream(null);
        Object.values(peersRef.current).forEach(p => p.destroy());
        
        if (user) {
            updateDoc(doc(db, 'calls', callId), { [`activeParticipants.${user._id}`]: deleteField() }).catch(console.error);
        }
        
        sessionStorage.removeItem(`audio_call_joined_${callId}`);
        navigate('/new-call', { replace: true });
    };

    const handleToggleMute = async () => {
        const current = muteStatus[user._id] ?? false;
        await updateDoc(doc(db, 'calls', callId), { [`muteStatus.${user._id}`]: !current });
    };

    const handleSendMessage = async (e) => {
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
            // Email JS logic...
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
        } catch(e) { console.error(e); toast.error("Error inviting"); }
        setIsInviting(false);
    };


    // --- RENDER VIEWS ---

    if (callState === 'loading') return <div className="bg-dark text-white vh-100 d-flex align-items-center justify-content-center">Loading...</div>;
    
    if (callState === 'denied') return <div className="bg-dark text-white vh-100 d-flex align-items-center justify-content-center"><h3>Access Denied</h3></div>;

    if (callState === 'waiting') return (
        <div className="bg-dark text-white vh-100 d-flex flex-column align-items-center justify-content-center">
            <div className="spinner-border text-primary mb-3"></div>
            <h4>Waiting for host...</h4>
        </div>
    );

    if (callState === 'joining') return (
        <div className="bg-dark text-white vh-100 d-flex flex-column align-items-center justify-content-center">
            <style jsx>{`
                .slider-container { position: relative; width: 300px; height: 60px; background: rgba(255,255,255,0.1); border-radius: 30px; display: flex; align-items: center; justify-content: center; overflow: hidden; border: 1px solid rgba(255,255,255,0.2); margin-bottom: 20px; user-select: none; }
                .slider-text-overlay { position: absolute; font-weight: 500; pointer-events: none; z-index: 1; display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; }
                .slider-thumb { position: absolute; left: 0; width: 60px; height: 100%; border-radius: 30px; display: flex; align-items: center; justify-content: center; font-size: 1.5rem; color: white; cursor: grab; z-index: 2; transition: left 0.1s; }
                .accept-color { background-color: #28a745; } .decline-color { background-color: #dc3545; }
            `}</style>
            <h2 className="mb-4">{callData?.ownerName}</h2>
            <p className="text-secondary mb-5">Audio Call</p>
            <SlideToActionButton onAction={handleJoin} text="Slide to Join" iconClass="bi-mic-fill" colorClass="accept-color" actionType="accept" />
            <SlideToActionButton onAction={() => navigate('/new-call')} text="Slide to Decline" iconClass="bi-telephone-x" colorClass="decline-color" actionType="decline" />
        </div>
    );

    // --- ACTIVE CALL UI ---
    return (
        <div className="audio-page-container" onClick={() => { setIsChatOpen(false); setAreControlsVisible(!areControlsVisible); }}>
            <style jsx>{`
                :root { --bg-dark: #12121c; --bg-card: #1e1e2f; --text-main: #e0e0e0; }
                .audio-page-container { background-color: var(--bg-dark); height: 100dvh; display: flex; flex-direction: column; overflow: hidden; color: var(--text-main); position: relative; }
                .audio-grid { flex-grow: 1; display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 2rem; padding: 2rem; overflow-y: auto; }
                .audio-tile { width: 180px; height: 180px; background-color: var(--bg-card); border-radius: 50%; display: flex; flex-direction: column; align-items: center; justify-content: center; border: 3px solid #3a3a5a; position: relative; transition: all 0.2s; }
                .audio-tile.speaking { border-color: #28a745; transform: scale(1.05); box-shadow: 0 0 20px rgba(40, 167, 69, 0.4); }
                .audio-avatar { font-size: 3.5rem; font-weight: 700; color: #fff; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; border-radius: 50%; }
                .audio-name { position: absolute; bottom: -40px; font-size: 1.1rem; font-weight: 500; display: flex; align-items: center; white-space: nowrap; }
                
                .controls-bar { height: 90px; background: rgba(0,0,0,0.5); backdrop-filter: blur(10px); display: flex; align-items: center; justify-content: center; gap: 1.5rem; flex-shrink: 0; position: absolute; bottom: 0; width: 100%; transition: transform 0.3s; z-index: 10; }
                .controls-bar.hidden { transform: translateY(100%); }
                .btn-ctrl { width: 55px; height: 55px; border-radius: 50%; border: none; display: flex; align-items: center; justify-content: center; font-size: 1.3rem; transition: 0.2s; color: white; cursor: pointer; }
                .btn-ctrl:hover { transform: scale(1.1); }
                .btn-secondary { background: #3a3a5a; } .btn-danger { background: #dc3545; } .btn-primary { background: #0d6efd; }
                
                .side-panel { position: absolute; top: 0; right: 0; bottom: 90px; width: 100%; max-width: 350px; background: var(--bg-card); border-left: 1px solid #333; z-index: 20; display: flex; flex-direction: column; }
                .panel-header { padding: 1rem; border-bottom: 1px solid #333; display: flex; justify-content: space-between; align-items: center; background: rgba(0,0,0,0.2); }
                .panel-body { flex: 1; overflow-y: auto; padding: 1rem; }
                .waiting-badge { position: absolute; top: 20px; left: 20px; background: rgba(255, 193, 7, 0.2); color: #ffc107; border: 1px solid #ffc107; padding: 8px 16px; border-radius: 20px; cursor: pointer; z-index: 5; font-weight: bold; animation: pulse 2s infinite; }
                @keyframes pulse { 0% { opacity: 0.7; } 50% { opacity: 1; } 100% { opacity: 0.7; } }
            `}</style>

            {/* Waiting Indicator */}
            {user._id === callOwnerId && waitingUsers.length > 0 && (
                <div className="waiting-badge" onClick={(e) => { e.stopPropagation(); setIsInviteModalOpen(true); }}>
                    {waitingUsers.length} Waiting...
                </div>
            )}

            {/* Audio Grid */}
            <div className="audio-grid">
                {/* Me */}
                <div className="audio-tile" style={{ borderColor: muteStatus[user._id] ? '#dc3545' : '#3a3a5a' }}>
                    <div className="audio-avatar" style={{ backgroundColor: muteStatus[user._id] ? '#333' : '#28a745' }}>
                        {user.firstname.charAt(0).toUpperCase()}
                    </div>
                    <div className="audio-name">
                        {muteStatus[user._id] ? <i className="bi bi-mic-mute-fill text-danger me-2"></i> : <i className="bi bi-mic-fill text-success me-2"></i>}
                        You
                    </div>
                </div>

                {/* Others */}
                {remoteStreams.map(rs => (
                    <RemoteAudioTile key={rs.id} peer={rs} name={participants.find(p => p.id === rs.id)?.name} />
                ))}
            </div>

            {/* Chat Panel */}
            {isChatOpen && (
                <div className="side-panel" onClick={e => e.stopPropagation()}>
                    <div className="panel-header">
                        <h5 className="m-0">Chat</h5>
                        <button className="btn-close btn-close-white" onClick={() => setIsChatOpen(false)}></button>
                    </div>
                    <div className="panel-body">
                        {messages.map(m => (
                            <div key={m.id} className="mb-2">
                                <small className="text-info fw-bold">{m.senderName}</small>
                                <div className="bg-dark p-2 rounded mt-1">{m.text}</div>
                            </div>
                        ))}
                        <div ref={chatEndRef}></div>
                    </div>
                    <div className="p-2 border-top border-secondary">
                        <form onSubmit={handleSendMessage} className="d-flex gap-2">
                            <input className="form-control bg-dark text-white border-secondary" value={newMessage} onChange={e => setNewMessage(e.target.value)} placeholder="Type..." />
                            <button className="btn btn-primary rounded-circle"><i className="bi bi-send-fill"></i></button>
                        </form>
                    </div>
                </div>
            )}

            {/* Invite/Participants Panel */}
            {isInviteModalOpen && (
                <div className="side-panel" style={{left:0, right:'auto', borderRight:'1px solid #333', borderLeft:'none'}} onClick={e => e.stopPropagation()}>
                    <div className="panel-header">
                        <h5 className="m-0">People</h5>
                        <button className="btn-close btn-close-white" onClick={() => setIsInviteModalOpen(false)}></button>
                    </div>
                    <div className="panel-body">
                        {/* Waiting */}
                        {user._id === callOwnerId && waitingUsers.length > 0 && (
                            <div className="mb-4">
                                <h6 className="text-warning border-bottom border-warning pb-2">Waiting Room</h6>
                                {waitingUsers.map(u => (
                                    <div key={u.id} className="d-flex justify-content-between align-items-center mb-2 mt-2">
                                        <span>{u.name}</span>
                                        <button className="btn btn-sm btn-success" onClick={() => handleAllowUser(u.id, u.name)}>Accept</button>
                                    </div>
                                ))}
                            </div>
                        )}
                        {/* Invite */}
                        <h6 className="text-white border-bottom pb-2">Invite via Email</h6>
                        <form onSubmit={handleSendInvites} className="mt-3">
                            <input className="form-control bg-dark text-white border-secondary mb-2" value={inviteEmails} onChange={e => setInviteEmails(e.target.value)} placeholder="user@example.com" />
                            <button className="btn btn-primary w-100" disabled={isInviting}>{isInviting ? 'Sending...' : 'Send'}</button>
                        </form>
                    </div>
                </div>
            )}

            {/* Controls */}
            <div className={`controls-bar ${!areControlsVisible ? 'hidden' : ''}`} onClick={e => e.stopPropagation()}>
                <button className={`btn-ctrl ${muteStatus[user._id] ? 'btn-danger' : 'btn-secondary'}`} onClick={handleToggleMute}>
                    <i className={`bi ${muteStatus[user._id] ? 'bi-mic-mute-fill' : 'bi-mic-fill'}`}></i>
                </button>
                
                <button className="btn-ctrl btn-primary" onClick={() => { setIsInviteModalOpen(!isInviteModalOpen); setIsChatOpen(false); }}>
                    <i className="bi bi-people-fill"></i>
                </button>

                <button className={`btn-ctrl ${isChatOpen ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { setIsChatOpen(!isChatOpen); setIsInviteModalOpen(false); }}>
                    <i className="bi bi-chat-dots-fill"></i>
                </button>

                <button className="btn-ctrl btn-danger" onClick={handleHangUp} style={{width: 65, height: 65}}>
                    <i className="bi bi-telephone-x-fill" style={{ fontSize: '1.6rem' }}></i>
                </button>
            </div>
        </div>
    );
}

export default AudioCall;