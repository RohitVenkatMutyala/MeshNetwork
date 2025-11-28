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
// Handles the remote stream playback and visual avatar
const RemoteAudioTile = ({ peer, name }) => {
    const audioRef = useRef(null);
    const [isMuted, setIsMuted] = useState(false);
    const [isSpeaking, setIsSpeaking] = useState(false);

    useEffect(() => {
        if (peer && peer.stream && audioRef.current) {
            // 1. Attach stream to audio element
            audioRef.current.srcObject = peer.stream;

            // 2. Handle Mute State from stream tracks
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

    // 3. Simple Audio Activity Detection (Visual Pulse)
    useEffect(() => {
        if (!peer || !peer.stream) return;
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const analyser = audioContext.createAnalyser();
        const microphone = audioContext.createMediaStreamSource(peer.stream);
        const javascriptNode = audioContext.createScriptProcessor(2048, 1, 1);

        analyser.smoothingTimeConstant = 0.8;
        analyser.fftSize = 1024;

        microphone.connect(analyser);
        analyser.connect(javascriptNode);
        javascriptNode.connect(audioContext.destination);

        javascriptNode.onaudioprocess = () => {
            const array = new Uint8Array(analyser.frequencyBinCount);
            analyser.getByteFrequencyData(array);
            let values = 0;
            const length = array.length;
            for (let i = 0; i < length; i++) {
                values += array[i];
            }
            const average = values / length;
            setIsSpeaking(average > 10); // Threshold for speaking
        };

        return () => {
            javascriptNode.disconnect();
            analyser.disconnect();
            microphone.disconnect();
            if(audioContext.state !== 'closed') audioContext.close();
        };
    }, [peer]);

    return (
        <div className={`audio-tile ${isSpeaking ? 'speaking' : ''}`}>
            {/* INVISIBLE AUDIO ELEMENT - CRITICAL FOR HEARING AUDIO */}
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

// --- COMPONENT: Slider Button (Reused) ---
function SlideToActionButton({ onAction, text, iconClass, colorClass, actionType }) {
    const [isDragging, setIsDragging] = useState(false);
    const [sliderLeft, setSliderLeft] = useState(0);
    const containerRef = useRef(null);
    const [completed, setCompleted] = useState(false);

    const handleDragMove = (e) => {
        if (!isDragging || completed || !containerRef.current) return;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const rect = containerRef.current.getBoundingClientRect();
        let newLeft = clientX - rect.left - 30;
        if (newLeft < 0) newLeft = 0;
        if (newLeft > rect.width - 60) newLeft = rect.width - 60;
        setSliderLeft(newLeft);
        
        if (newLeft >= rect.width - 65) {
            setCompleted(true);
            setIsDragging(false);
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
                style={{ left: sliderLeft }}
                onMouseDown={() => setIsDragging(true)}
                onTouchStart={() => setIsDragging(true)}
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

    // --- State ---
    const [callState, setCallState] = useState('loading'); // loading, joining, active, denied, waiting
    const [callData, setCallData] = useState(null);
    const [callOwnerId, setCallOwnerId] = useState(null);
    
    // Media & Peers
    const [stream, setStream] = useState(null);
    const [participants, setParticipants] = useState([]);
    const [waitingUsers, setWaitingUsers] = useState([]);
    const [remoteStreams, setRemoteStreams] = useState([]); // Array of { id, stream }
    const [muteStatus, setMuteStatus] = useState({});
    
    // UI
    const [messages, setMessages] = useState([]);
    const [newMessage, setNewMessage] = useState('');
    const [isChatOpen, setIsChatOpen] = useState(false);
    const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
    const [inviteEmails, setInviteEmails] = useState('');
    const [isInviting, setIsInviting] = useState(false);

    // Refs
    const peersRef = useRef({});
    const chatEndRef = useRef(null);
    const participantsRef = useRef(participants);

    useEffect(() => { participantsRef.current = participants; }, [participants]);

    // --- 1. Init & Firestore Listeners ---
    useEffect(() => {
        if (loading) return;
        if (!user) { navigate('/login'); return; }
        if (!callId) { setCallState('denied'); return; }

        const callDocRef = doc(db, 'calls', callId);

        // Presence Heartbeat
        const hb = setInterval(() => {
            if (participantsRef.current.find(p => p.id === user._id)) {
                updateDoc(callDocRef, { [`activeParticipants.${user._id}.lastSeen`]: serverTimestamp() }).catch(() => {});
            }
        }, 30000);

        // Listen to Call Data
        const unsubCall = onSnapshot(callDocRef, (snap) => {
            if (!snap.exists()) { setCallState('denied'); return; }
            const data = snap.data();
            setCallData(data);
            setCallOwnerId(data.ownerId);

            // Access Check
            const isOwner = data.ownerId === user._id;
            const isAllowed = (data.allowedEmails || []).includes(user.email) || isOwner;
            if (!isAllowed) { setCallState('denied'); return; }

            // Sync State
            const pMap = data.activeParticipants || {};
            setParticipants(Object.entries(pMap).map(([id, val]) => ({ id, name: val.name })));
            
            const wMap = data.waitingRoom || {};
            setWaitingUsers(Object.entries(wMap).map(([id, val]) => ({ id, name: val.name })));
            
            setMuteStatus(data.muteStatus || {});

            // Determination of UI State
            if (callState === 'loading') {
                const sessionJoined = sessionStorage.getItem(`audio_join_${callId}`);
                if (sessionJoined || pMap[user._id]) {
                    setCallState('active'); // Already joined
                } else if (isOwner) {
                    setCallState('joining'); // Owner needs to click start
                } else {
                    setCallState('waiting'); // Guest waits
                    // Add to waiting room if not already there
                    if (!wMap[user._id]) {
                        updateDoc(callDocRef, { [`waitingRoom.${user._id}`]: { name: `${user.firstname} ${user.lastname}` } });
                    }
                }
            } else if (callState === 'waiting') {
                // Check if we got accepted
                if (pMap[user._id]) setCallState('joining');
            }
        });

        // Listen to Messages
        const unsubMsg = onSnapshot(query(collection(db, 'calls', callId, 'messages'), orderBy('timestamp')), 
            (snap) => setMessages(snap.docs.map(d => ({ id: d.id, ...d.data() }))));

        return () => {
            clearInterval(hb);
            unsubCall();
            unsubMsg();
            // Cleanup on unmount
            if (stream) stream.getTracks().forEach(t => t.stop());
            Object.values(peersRef.current).forEach(p => p.destroy());
        };
    }, [callId, user, loading, navigate]);

    // --- 2. WebRTC Logic (Audio Only) ---
    // Using participantIDs as dependency ensures connections trigger on changes
    const participantIDs = JSON.stringify(participants.map(p => p.id).sort());

    useEffect(() => {
        if (!stream || callState !== 'active' || !user) return;

        const signalRef = collection(db, 'calls', callId, 'signaling');

        const addRemoteStream = (uid, s) => {
            setRemoteStreams(prev => {
                if(prev.find(x => x.id === uid)) return prev;
                return [...prev, { id: uid, stream: s }];
            });
        };

        // Initiator
        const createPeer = (targetId) => {
            if(peersRef.current[targetId]) return; // Already exists
            const p = new Peer({ initiator: true, trickle: false, stream });
            
            p.on('signal', signal => {
                addDoc(signalRef, { recipientId: targetId, senderId: user._id, signal, type: 'audio' });
            });
            p.on('stream', s => addRemoteStream(targetId, s));
            p.on('close', () => {
                setRemoteStreams(prev => prev.filter(x => x.id !== targetId));
                delete peersRef.current[targetId];
            });
            peersRef.current[targetId] = p;
        };

        // Receiver
        const addPeer = (data) => {
            if(peersRef.current[data.senderId]) {
                peersRef.current[data.senderId].signal(data.signal);
                return;
            }
            const p = new Peer({ initiator: false, trickle: false, stream });
            
            p.on('signal', signal => {
                addDoc(signalRef, { recipientId: data.senderId, senderId: user._id, signal, type: 'audio' });
            });
            p.on('stream', s => addRemoteStream(data.senderId, s));
            p.signal(data.signal);
            peersRef.current[data.senderId] = p;
        };

        // Mesh Connect: Connect to everyone else in the call
        participants.forEach(p => {
            if (p.id !== user._id && !peersRef.current[p.id]) {
                createPeer(p.id);
            }
        });

        // Signaling Listener
        const unsubSignal = onSnapshot(query(signalRef), (snap) => {
            snap.docChanges().forEach(change => {
                if (change.type === 'added') {
                    const d = change.doc.data();
                    if (d.recipientId === user._id) {
                        if (d.signal.type === 'offer') addPeer(d);
                        else if (peersRef.current[d.senderId]) peersRef.current[d.senderId].signal(d.signal);
                        deleteDoc(change.doc.ref); // Consume signal
                    }
                }
            });
        });

        return () => unsubSignal();
    }, [stream, callState, user, participantIDs, callId]);

    // --- 3. Mute Logic Handling ---
    useEffect(() => {
        if (!stream || !user || !stream.getAudioTracks().length) return;
        const shouldBeMuted = muteStatus[user._id] ?? false;
        // Local track logic
        stream.getAudioTracks()[0].enabled = !shouldBeMuted;
    }, [muteStatus, stream, user]);


    // --- 4. Actions ---

    const handleJoin = async () => {
        try {
            // Get Audio Only Stream
            const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            setStream(s);
            
            // Add self to participants in DB
            await updateDoc(doc(db, 'calls', callId), {
                [`activeParticipants.${user._id}`]: { name: `${user.firstname} ${user.lastname}`, lastSeen: serverTimestamp() },
                [`muteStatus.${user._id}`]: false,
                [`waitingRoom.${user._id}`]: deleteField()
            });
            
            sessionStorage.setItem(`audio_join_${callId}`, 'true');
            setCallState('active');
        } catch (e) {
            console.error(e);
            toast.error("Microphone access denied. Check permissions.");
        }
    };

    const handleHangup = async () => {
        if (stream) stream.getTracks().forEach(t => t.stop());
        setStream(null);
        
        // Remove from DB
        if (user) {
            await updateDoc(doc(db, 'calls', callId), { [`activeParticipants.${user._id}`]: deleteField() });
        }
        
        sessionStorage.removeItem(`audio_join_${callId}`);
        navigate('/new-call');
    };

    const handleToggleMute = async () => {
        if (!user) return;
        const current = muteStatus[user._id] ?? false;
        await updateDoc(doc(db, 'calls', callId), { [`muteStatus.${user._id}`]: !current });
    };

    const handleSendMsg = async (e) => {
        e.preventDefault();
        if(!newMessage.trim()) return;
        await addDoc(collection(db, 'calls', callId, 'messages'), {
            text: newMessage,
            senderName: `${user.firstname} ${user.lastname}`,
            senderId: user._id,
            timestamp: serverTimestamp()
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

    const handleSendInvite = async (e) => {
        e.preventDefault();
        if (!inviteEmails.trim()) return;
        setIsInviting(true);
        const emails = inviteEmails.split(',').map(e => e.trim()).filter(e => e);
        
        try {
            // Update permissions
            await updateDoc(doc(db, 'calls', callId), { allowedEmails: arrayUnion(...emails) });
            
            // Send Emails
            const serviceID = 'service_y8qops6'; // Ensure these are correct
            const templateID = 'template_apzjekq';
            const pubKey = 'Cd-NUUSJ5dW3GJMo0';
            
            for(const email of emails) {
                await emailjs.send(serviceID, templateID, {
                    from_name: `${user.firstname} ${user.lastname}`,
                    to_email: email,
                    session_description: 'Join my Audio Call',
                    session_link: window.location.href
                }, pubKey);
            }
            toast.success("Invites sent!");
            setIsInviteModalOpen(false);
            setInviteEmails('');
        } catch(e) {
            console.error(e);
            toast.error("Failed to send invites");
        } finally {
            setIsInviting(false);
        }
    };

    // --- RENDER ---

    // 1. Loading
    if (callState === 'loading') return <div className="bg-dark text-white vh-100 d-flex align-items-center justify-content-center">Loading...</div>;
    
    // 2. Denied
    if (callState === 'denied') return <div className="bg-dark text-white vh-100 d-flex align-items-center justify-content-center"><h3>Access Denied or Call Ended</h3></div>;

    // 3. Waiting Room
    if (callState === 'waiting') return (
        <div className="bg-dark text-white vh-100 d-flex flex-column align-items-center justify-content-center">
            <div className="spinner-border text-primary mb-3"></div>
            <h4>Waiting for host to let you in...</h4>
        </div>
    );

    // 4. Joining Screen (Slider)
    if (callState === 'joining') return (
        <div className="bg-dark text-white vh-100 d-flex flex-column align-items-center justify-content-center">
            <h2 className="mb-4">{callData?.ownerName}'s Call</h2>
            <p className="text-secondary mb-5">Audio Only</p>
            <SlideToActionButton onAction={handleJoin} text="Slide to Join" iconClass="bi-mic-fill" colorClass="accept-color" actionType="accept" />
            <div style={{height: 20}}></div>
            <SlideToActionButton onAction={() => navigate('/new-call')} text="Slide to Decline" iconClass="bi-telephone-x" colorClass="decline-color" actionType="decline" />
        </div>
    );

    // 5. Active Call
    return (
        <div className="vh-100 bg-dark text-white d-flex flex-column overflow-hidden position-relative">
            <style jsx>{`
                .slider-container { position: relative; width: 300px; height: 60px; background: rgba(255,255,255,0.1); border-radius: 30px; display: flex; align-items: center; justify-content: center; overflow: hidden; border: 1px solid rgba(255,255,255,0.2); user-select: none; }
                .slider-thumb { position: absolute; left: 0; top:0; width: 60px; height: 60px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 1.5rem; color: white; cursor: grab; z-index: 2; }
                .slider-text { z-index: 1; font-weight: 500; }
                .accept-color { background: #28a745; } .decline-color { background: #dc3545; }
                
                .audio-grid { flex: 1; display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 20px; padding: 20px; overflow-y: auto; }
                .audio-tile { width: 160px; height: 160px; background: #1e1e2f; border-radius: 50%; display: flex; flex-direction: column; align-items: center; justify-content: center; border: 3px solid #3a3a5a; transition: all 0.2s; position: relative; }
                .audio-tile.speaking { border-color: #28a745; box-shadow: 0 0 15px rgba(40, 167, 69, 0.5); transform: scale(1.05); }
                .audio-avatar { font-size: 3.5rem; font-weight: bold; color: #e0e0e0; }
                .audio-name { position: absolute; bottom: -35px; font-size: 1rem; width: 200px; text-align: center; text-shadow: 0 1px 3px rgba(0,0,0,0.5); }
                
                .controls { height: 80px; background: rgba(0,0,0,0.6); backdrop-filter: blur(5px); display: flex; justify-content: center; align-items: center; gap: 20px; position: relative; z-index: 10; }
                .btn-ctrl { width: 50px; height: 50px; border-radius: 50%; border: none; font-size: 1.2rem; display: flex; align-items: center; justify-content: center; transition: 0.2s; color: white; }
                .btn-secondary { background: #3a3a5a; } .btn-danger { background: #dc3545; } .btn-primary { background: #0d6efd; }
                
                .chat-panel { position: absolute; right: 0; top: 0; bottom: 80px; width: 100%; max-width: 350px; background: #1e1e2f; border-left: 1px solid #444; display: flex; flex-direction: column; z-index: 20; box-shadow: -5px 0 15px rgba(0,0,0,0.5); }
                .waiting-indicator { position: absolute; top: 20px; left: 20px; background: rgba(255, 193, 7, 0.2); border: 1px solid #ffc107; padding: 10px 20px; border-radius: 20px; cursor: pointer; animation: pulse 2s infinite; }
                @keyframes pulse { 0% { opacity: 0.8; } 50% { opacity: 1; } 100% { opacity: 0.8; } }
            `}</style>

            {/* Waiting Room Button (Host Only) */}
            {user._id === callOwnerId && waitingUsers.length > 0 && (
                <div className="waiting-indicator" onClick={() => setIsInviteModalOpen(true)}>
                    <i className="bi bi-person-exclamation me-2"></i>
                    {waitingUsers.length} Waiting
                </div>
            )}

            {/* Main Grid */}
            <div className="audio-grid" onClick={() => setIsChatOpen(false)}>
                {/* Local User */}
                <div className={`audio-tile`} style={{ borderColor: muteStatus[user._id] ? '#dc3545' : '#3a3a5a' }}>
                    <div className="audio-avatar">{user.firstname.charAt(0).toUpperCase()}</div>
                    <div className="audio-name">
                        You {muteStatus[user._id] && <i className="bi bi-mic-mute-fill text-danger ms-1"></i>}
                    </div>
                </div>

                {/* Remote Users */}
                {remoteStreams.map(rs => (
                    <RemoteAudioTile key={rs.id} peer={rs} name={participants.find(p => p.id === rs.id)?.name} />
                ))}
            </div>

            {/* Chat Overlay */}
            {isChatOpen && (
                <div className="chat-panel">
                    <div className="p-3 border-bottom d-flex justify-content-between align-items-center bg-dark">
                        <h5 className="m-0">Chat</h5>
                        <button className="btn-close btn-close-white" onClick={() => setIsChatOpen(false)}></button>
                    </div>
                    <div className="flex-grow-1 p-3 overflow-auto">
                        {messages.map(m => (
                            <div key={m.id} className="mb-2">
                                <div className="fw-bold text-info" style={{fontSize: '0.8rem'}}>{m.senderName}</div>
                                <div className="bg-dark p-2 rounded d-inline-block">{m.text}</div>
                            </div>
                        ))}
                        <div ref={chatEndRef}></div>
                    </div>
                    <div className="p-2 border-top bg-dark">
                        <form onSubmit={handleSendMsg} className="d-flex gap-2">
                            <input className="form-control bg-secondary text-white border-0" value={newMessage} onChange={e => setNewMessage(e.target.value)} placeholder="Type a message..." />
                            <button className="btn btn-primary rounded-circle"><i className="bi bi-send-fill"></i></button>
                        </form>
                    </div>
                </div>
            )}

            {/* Invite/Participants Modal */}
            {isInviteModalOpen && (
                <div className="chat-panel" style={{ left: 0, right: 'auto', borderRight: '1px solid #444', borderLeft: 'none' }}>
                    <div className="p-3 border-bottom d-flex justify-content-between align-items-center bg-dark">
                        <h5 className="m-0">Participants</h5>
                        <button className="btn-close btn-close-white" onClick={() => setIsInviteModalOpen(false)}></button>
                    </div>
                    <div className="p-3 overflow-auto">
                        {/* Waiting Section */}
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

                        {/* Invite Section */}
                        <h6 className="text-white border-bottom pb-2">Invite via Email</h6>
                        <form onSubmit={handleSendInvite} className="mt-3">
                            <input className="form-control bg-dark text-white border-secondary mb-2" value={inviteEmails} onChange={e => setInviteEmails(e.target.value)} placeholder="email@example.com" />
                            <button className="btn btn-primary w-100" disabled={isInviting}>
                                {isInviting ? 'Sending...' : 'Send Invitation'}
                            </button>
                        </form>
                    </div>
                </div>
            )}

            {/* Bottom Controls */}
            <div className="controls">
                <button 
                    className={`btn-ctrl ${muteStatus[user._id] ? 'btn-danger' : 'btn-secondary'}`} 
                    onClick={handleToggleMute}
                    title={muteStatus[user._id] ? "Unmute" : "Mute"}
                >
                    <i className={`bi ${muteStatus[user._id] ? 'bi-mic-mute-fill' : 'bi-mic-fill'}`}></i>
                </button>
                
                <button className="btn-ctrl btn-primary" onClick={() => setIsInviteModalOpen(!isInviteModalOpen)} title="Add/View People">
                    <i className="bi bi-people-fill"></i>
                </button>

                <button className={`btn-ctrl ${isChatOpen ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setIsChatOpen(!isChatOpen)} title="Chat">
                    <i className="bi bi-chat-dots-fill"></i>
                </button>

                <button className="btn-ctrl btn-danger" onClick={handleHangup} style={{width: 60, height: 60}} title="Hang Up">
                    <i className="bi bi-telephone-x-fill" style={{ fontSize: '1.5rem' }}></i>
                </button>
            </div>
        </div>
    );
}

export default AudioCall;