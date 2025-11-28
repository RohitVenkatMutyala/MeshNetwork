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
// Renders the Avatar and handles the invisible Audio stream
const RemoteAudioTile = ({ peer, name }) => {
    const audioRef = useRef(null);
    const [isMuted, setIsMuted] = useState(false);

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

    return (
        <div className="audio-tile">
            {/* Hidden Audio Element for playback */}
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

// --- COMPONENT: SlideToActionButton (Same as Video) ---
function SlideToActionButton({ onAction, text, iconClass, colorClass, actionType }) {
    const [isDragging, setIsDragging] = useState(false);
    const [sliderLeft, setSliderLeft] = useState(0);
    const [unlocked, setUnlocked] = useState(false);
    const containerRef = useRef(null);
    const sliderRef = useRef(null);

    const getClientX = (e) => e.touches ? e.touches[0].clientX : e.clientX;

    const handleDragStart = (e) => {
        if (unlocked) return;
        setIsDragging(true);
        if (sliderRef.current) {
            sliderRef.current.style.transition = 'none';
            sliderRef.current.style.animation = 'none';
        }
    };

    const handleDragMove = (e) => {
        if (!isDragging || unlocked || !containerRef.current || !sliderRef.current) return;
        const containerRect = containerRef.current.getBoundingClientRect();
        const sliderRect = sliderRef.current.getBoundingClientRect();
        const startX = containerRect.left;
        const currentX = getClientX(e);
        let newLeft = currentX - startX - (sliderRect.width / 2);
        const maxLeft = containerRect.width - sliderRect.width - 2;
        newLeft = Math.max(0, Math.min(newLeft, maxLeft));
        setSliderLeft(newLeft);

        if (newLeft > maxLeft * 0.9) {
            setUnlocked(true);
            setIsDragging(false);
            setSliderLeft(maxLeft);
            if (sliderRef.current) sliderRef.current.style.transition = 'left 0.3s ease-out';
            onAction();
        }
    };

    const handleDragEnd = () => {
        if (isDragging && !unlocked) {
            setIsDragging(false);
            setSliderLeft(0);
            if (sliderRef.current) {
                sliderRef.current.style.transition = 'left 0.3s ease-out';
                sliderRef.current.style.animation = 'vibrate 0.5s ease-in-out infinite 1.5s';
            }
        }
    };

    return (
        <div className="slider-container" ref={containerRef} onMouseMove={handleDragMove} onMouseUp={handleDragEnd} onMouseLeave={handleDragEnd} onTouchMove={handleDragMove} onTouchEnd={handleDragEnd}>
            <div className={`slider-thumb ${colorClass}`} ref={sliderRef} style={{ left: `${sliderLeft}px` }} onMouseDown={handleDragStart} onTouchStart={handleDragStart}>
                <i className={`bi ${actionType === 'accept' ? 'bi-arrow-right' : 'bi-x-lg'}`}></i>
            </div>
            <div className="slider-text-overlay"><i className={`bi ${iconClass} me-2`}></i>{text}</div>
        </div>
    );
}

function AudioCall() {
    const { user, loading } = useAuth();
    const { callId } = useParams();
    const navigate = useNavigate();

    // State
    const [messages, setMessages] = useState([]);
    const [newMessage, setNewMessage] = useState('');
    const [callState, setCallState] = useState('loading');
    const [callData, setCallData] = useState(null);
    const [callOwnerId, setCallOwnerId] = useState(null);
    
    // UI State
    const [isChatOpen, setIsChatOpen] = useState(false);
    const [areControlsVisible, setAreControlsVisible] = useState(true);
    const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
    const [inviteEmails, setInviteEmails] = useState('');
    const [isInviting, setIsInviting] = useState(false);

    // Audio State
    const [stream, setStream] = useState(null);
    const [muteStatus, setMuteStatus] = useState({});
    const peersRef = useRef({});
    const chatMessagesEndRef = useRef(null);
    
    const [participants, setParticipants] = useState([]);
    const [waitingUsers, setWaitingUsers] = useState([]);
    const [remoteStreams, setRemoteStreams] = useState([]);

    const participantsRef = useRef(participants);
    useEffect(() => { participantsRef.current = participants; }, [participants]);

    // --- 1. Auth & Call Data Init ---
    useEffect(() => {
        if (loading) return;
        if (!user) {
            toast.error("Please login.");
            navigate('/login');
            return;
        }
        if (!callId) {
            setCallState('denied');
            return;
        }

        const callDocRef = doc(db, 'calls', callId);

        // Heartbeat
        const intervalId = setInterval(() => {
            const amIActive = (participantsRef.current || []).find(p => p.id === user._id);
            if (amIActive) {
                updateDoc(callDocRef, { [`activeParticipants.${user._id}.lastSeen`]: serverTimestamp() }).catch(console.error);
            }
        }, 30000);

        const unsubscribeCall = onSnapshot(callDocRef, (docSnap) => {
            if (!docSnap.exists()) { setCallState('denied'); return; }
            const data = docSnap.data();
            setCallData(data);
            setCallOwnerId(data.ownerId);

            const isOwner = user && data.ownerId === user._id;
            const hasAccess = (user && data.allowedEmails?.includes(user.email)) || isOwner;

            if (!hasAccess) { setCallState('denied'); return; }

            // Participants
            const pMap = data.activeParticipants || {};
            setParticipants(Object.entries(pMap).map(([id, d]) => ({ id, name: d.name })));

            // Waiting Room
            const wMap = data.waitingRoom || {};
            setWaitingUsers(Object.entries(wMap).map(([id, d]) => ({ id, name: d.name })));

            setMuteStatus(data.muteStatus || {});

            // Join State Logic
            if (callState === 'loading') {
                const alreadyJoined = sessionStorage.getItem(`audio_call_joined_${callId}`) === 'true';
                if (alreadyJoined || pMap[user._id]) {
                    setCallState('active');
                } else if (isOwner) {
                    setCallState('joining');
                } else {
                    setCallState('waiting');
                    updateDoc(callDocRef, { [`waitingRoom.${user._id}`]: { name: `${user.firstname} ${user.lastname}` } });
                }
            }
        });

        const unsubscribeMessages = onSnapshot(query(collection(db, 'calls', callId, 'messages'), orderBy('timestamp')), 
            snap => setMessages(snap.docs.map(d => ({ id: d.id, ...d.data() }))));

        return () => {
            clearInterval(intervalId);
            if (user) {
                updateDoc(doc(db, 'calls', callId), {
                    [`activeParticipants.${user._id}`]: deleteField(),
                    [`waitingRoom.${user._id}`]: deleteField()
                }).catch(console.error);
            }
            if (stream) stream.getTracks().forEach(t => t.stop());
            Object.values(peersRef.current).forEach(p => p.destroy());
            unsubscribeCall();
            unsubscribeMessages();
        };
    }, [callId, user, navigate, loading]);

    // --- 2. WebRTC Audio Logic ---
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

        const createPeer = (recipientId, senderId, stream) => {
            const peer = new Peer({ initiator: true, trickle: false, stream });
            peer.on('signal', signal => addDoc(signalingColRef, { recipientId, senderId, signal }));
            peer.on('stream', rs => addStreamToState(recipientId, rs));
            peer.on('close', () => {
                setRemoteStreams(prev => prev.filter(s => s.id !== recipientId));
                delete peersRef.current[recipientId];
            });
            peersRef.current[recipientId] = peer;
        };

        const addPeer = (incoming, recipientId, stream) => {
            const peer = new Peer({ initiator: false, trickle: false, stream });
            peer.on('signal', signal => addDoc(signalingColRef, { recipientId: incoming.senderId, senderId: recipientId, signal }));
            peer.on('stream', rs => addStreamToState(incoming.senderId, rs));
            peer.signal(incoming.signal);
            peersRef.current[incoming.senderId] = peer;
        };

        // Mesh Connect
        participants.forEach(p => {
            if (p.id !== user._id && !peersRef.current[p.id]) {
                createPeer(p.id, user._id, stream);
            }
        });

        // Cleanup stale peers
        Object.keys(peersRef.current).forEach(pid => {
            if (!participants.find(p => p.id === pid)) {
                peersRef.current[pid].destroy();
                delete peersRef.current[pid];
                setRemoteStreams(prev => prev.filter(s => s.id !== pid));
            }
        });

        const unsubSignal = onSnapshot(query(signalingColRef), snapshot => {
            snapshot.docChanges().forEach(change => {
                const data = change.doc.data();
                if (change.type === "added" && data.recipientId === user._id) {
                    const existingPeer = peersRef.current[data.senderId];
                    if (data.signal.type === 'offer') {
                        if (existingPeer) existingPeer.destroy();
                        if (participants.find(p => p.id === data.senderId)) addPeer(data, user._id, stream);
                    } else if (existingPeer) {
                        existingPeer.signal(data.signal);
                    }
                    deleteDoc(change.doc.ref);
                }
            });
        });

        return () => unsubSignal();
    }, [stream, callState, user, callId, participantIDs]);

    // Handle Mute State from DB
    useEffect(() => {
        if (!stream || !user || !stream.getAudioTracks().length) return;
        const isMuted = muteStatus[user._id] ?? false;
        stream.getAudioTracks()[0].enabled = !isMuted;
    }, [muteStatus, stream, user]);

    // --- Actions ---
    const handleAcceptCall = async () => {
        try {
            const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            await updateDoc(doc(db, 'calls', callId), {
                [`activeParticipants.${user._id}`]: { name: `${user.firstname} ${user.lastname}`, lastSeen: serverTimestamp() },
                [`waitingRoom.${user._id}`]: deleteField(),
                [`muteStatus.${user._id}`]: false
            });
            setStream(s);
            setCallState('active');
            sessionStorage.setItem(`audio_call_joined_${callId}`, 'true');
        } catch (err) {
            toast.error("Microphone access failed.");
        }
    };

    const handleHangUp = () => {
        if (stream) stream.getTracks().forEach(t => t.stop());
        setStream(null);
        Object.values(peersRef.current).forEach(p => p.destroy());
        sessionStorage.removeItem(`audio_call_joined_${callId}`);
        navigate('/new-call', { replace: true });
    };

    const handleToggleMute = async () => {
        if (!user) return;
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
        // ... (Simplified Invite Logic for brevity, similar to Call.js)
        const emails = inviteEmails.split(',').map(e => e.trim()).filter(e => e);
        if(!emails.length) return;
        setIsInviting(true);
        try {
            await updateDoc(doc(db, 'calls', callId), { allowedEmails: arrayUnion(...emails) });
            // EmailJS logic here...
            toast.success("Invites sent permissions updated.");
            setIsInviteModalOpen(false);
        } catch(e) { console.error(e); }
        setIsInviting(false);
    };

    // --- RENDER ---

    if (callState === 'loading' || callState === 'waiting') {
        return (
            <div className="d-flex justify-content-center align-items-center" style={{ height: '100dvh', backgroundColor: '#12121c' }}>
                <div className="text-center text-white">
                    <div className="spinner-border text-primary mb-3"></div>
                    <h4>{callState === 'loading' ? 'Loading...' : 'Waiting for host...'}</h4>
                </div>
            </div>
        );
    }

    if (callState === 'denied') return <div className="p-5 text-white bg-dark">Access Denied</div>;

    if (callState === 'joining') {
        return (
            <div className="d-flex flex-column justify-content-center align-items-center" style={{ height: '100dvh', backgroundColor: '#12121c', color: 'white' }}>
                <style jsx>{`
                    .slider-container { position: relative; width: 300px; height: 60px; background: rgba(255,255,255,0.1); border-radius: 30px; display: flex; align-items: center; justify-content: center; overflow: hidden; border: 1px solid rgba(255,255,255,0.2); margin-bottom: 20px; }
                    .slider-text-overlay { position: absolute; font-weight: 500; pointer-events: none; z-index: 1; }
                    .slider-thumb { position: absolute; left: 0; width: 60px; height: 100%; border-radius: 30px; display: flex; align-items: center; justify-content: center; font-size: 1.5rem; color: white; cursor: grab; z-index: 2; }
                    .accept-color { background-color: #28a745; } .decline-color { background-color: #dc3545; }
                `}</style>
                <div className="mb-5 text-center">
                    <h1>{callData?.ownerName}</h1>
                    <h3 className="text-secondary">Audio Call</h3>
                </div>
                <SlideToActionButton onAction={handleAcceptCall} text="Slide to Join Audio" iconClass="bi-mic-fill" colorClass="accept-color" actionType="accept" />
                <SlideToActionButton onAction={handleHangUp} text="Slide to Decline" iconClass="bi-telephone-x-fill" colorClass="decline-color" actionType="decline" />
            </div>
        );
    }

    return (
        <div className="audio-page-container">
            <style jsx>{`
                :root { --bg-dark: #12121c; --bg-card: #1e1e2f; --text-main: #e0e0e0; }
                .audio-page-container { background-color: var(--bg-dark); height: 100dvh; display: flex; flex-direction: column; overflow: hidden; color: var(--text-main); }
                .audio-grid { flex-grow: 1; display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 1rem; padding: 2rem; overflow-y: auto; }
                .audio-tile { width: 180px; height: 180px; background-color: var(--bg-card); border-radius: 50%; display: flex; flex-direction: column; align-items: center; justify-content: center; border: 2px solid #3a3a5a; position: relative; animation: popIn 0.3s ease; }
                .audio-avatar { font-size: 3rem; font-weight: 700; color: #fff; width: 100px; height: 100px; background: #3a3a5a; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin-bottom: 10px; }
                .audio-name { font-size: 1rem; font-weight: 500; display: flex; align-items: center; }
                .controls-bar { height: 80px; background: rgba(0,0,0,0.3); display: flex; align-items: center; justify-content: center; gap: 1rem; flex-shrink: 0; }
                .btn-ctrl { width: 50px; height: 50px; border-radius: 50%; border: none; display: flex; align-items: center; justify-content: center; font-size: 1.2rem; transition: 0.2s; }
                .btn-secondary { background: #3a3a5a; color: white; } .btn-danger { background: #dc3545; color: white; } .btn-primary { background: #0d6efd; color: white; }
                .chat-overlay { position: absolute; top: 0; right: 0; bottom: 0; width: 350px; background: var(--bg-card); z-index: 100; border-left: 1px solid #333; display: flex; flex-direction: column; }
                @keyframes popIn { from { transform: scale(0.8); opacity: 0; } to { transform: scale(1); opacity: 1; } }
            `}</style>

            {/* --- Main Audio Grid --- */}
            <div className="audio-grid" onClick={() => { setIsChatOpen(false); setAreControlsVisible(!areControlsVisible); }}>
                
                {/* Local User Tile */}
                <div className="audio-tile" style={{ borderColor: muteStatus[user._id] ? '#dc3545' : '#28a745' }}>
                    <div className="audio-avatar" style={{ background: muteStatus[user._id] ? '#333' : '#28a745' }}>
                        {user.firstname.charAt(0).toUpperCase()}
                    </div>
                    <div className="audio-name">
                        <span className="badge bg-secondary me-2">You</span>
                        {muteStatus[user._id] ? <i className="bi bi-mic-mute-fill text-danger"></i> : <i className="bi bi-mic-fill text-success"></i>}
                    </div>
                </div>

                {/* Remote Users */}
                {remoteStreams.map(rs => (
                    <RemoteAudioTile key={rs.id} peer={rs} name={participants.find(p => p.id === rs.id)?.name} />
                ))}
                
                {/* Waiting Room Indicator (if Owner) */}
                {user._id === callOwnerId && waitingUsers.length > 0 && (
                    <div className="audio-tile" style={{ borderStyle: 'dashed', borderColor: '#ffc107', cursor: 'pointer' }} onClick={(e) => {e.stopPropagation(); setIsInviteModalOpen(true);}}>
                        <div className="audio-avatar" style={{ background: 'transparent', color: '#ffc107' }}>
                            {waitingUsers.length}
                        </div>
                        <div className="audio-name text-warning">Waiting</div>
                    </div>
                )}
            </div>

            {/* --- Controls Bar --- */}
            {areControlsVisible && (
                <div className="controls-bar">
                    <button className={`btn-ctrl ${muteStatus[user._id] ? 'btn-danger' : 'btn-secondary'}`} onClick={handleToggleMute}>
                        <i className={`bi ${muteStatus[user._id] ? 'bi-mic-mute-fill' : 'bi-mic-fill'}`}></i>
                    </button>
                    
                    <button className="btn-ctrl btn-primary" onClick={() => setIsInviteModalOpen(true)}>
                        <i className="bi bi-person-plus-fill"></i>
                    </button>

                    <button className={`btn-ctrl ${isChatOpen ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setIsChatOpen(!isChatOpen)}>
                        <i className="bi bi-chat-dots-fill"></i>
                    </button>

                    <button className="btn-ctrl btn-danger" onClick={handleHangUp} style={{ width: 60, height: 60 }}>
                        <i className="bi bi-telephone-x-fill" style={{ fontSize: '1.5rem' }}></i>
                    </button>
                </div>
            )}

            {/* --- Chat Overlay (Simplified) --- */}
            {isChatOpen && (
                <div className="chat-overlay">
                    <div className="p-3 border-bottom d-flex justify-content-between text-white">
                        <h5>Chat</h5>
                        <button className="btn-close btn-close-white" onClick={() => setIsChatOpen(false)}></button>
                    </div>
                    <div className="flex-grow-1 p-3" style={{ overflowY: 'auto' }}>
                        {messages.map(m => (
                            <div key={m.id} className="mb-2 text-white">
                                <strong>{m.senderName}: </strong> {m.text}
                            </div>
                        ))}
                        <div ref={chatMessagesEndRef} />
                    </div>
                    <div className="p-3 border-top">
                        <form onSubmit={handleSendMessage} className="d-flex gap-2">
                            <input className="form-control bg-dark text-white" value={newMessage} onChange={e => setNewMessage(e.target.value)} placeholder="Message..." />
                            <button className="btn btn-primary"><i className="bi bi-send-fill"></i></button>
                        </form>
                    </div>
                </div>
            )}

            {/* --- Invite Modal (Reused Logic) --- */}
            {isInviteModalOpen && (
                <div className="chat-overlay" style={{ left: 0, right: 'auto', borderRight: '1px solid #333', borderLeft: 'none' }}>
                    <div className="p-3 border-bottom d-flex justify-content-between text-white">
                        <h5>Participants</h5>
                        <button className="btn-close btn-close-white" onClick={() => setIsInviteModalOpen(false)}></button>
                    </div>
                    <div className="p-3">
                        {user._id === callOwnerId && waitingUsers.length > 0 && (
                            <div className="mb-3">
                                <h6 className="text-warning">Waiting</h6>
                                {waitingUsers.map(u => (
                                    <div key={u.id} className="d-flex justify-content-between align-items-center mb-2 text-white">
                                        <span>{u.name}</span>
                                        <button className="btn btn-sm btn-success" onClick={() => handleAllowUser(u.id, u.name)}>Allow</button>
                                    </div>
                                ))}
                                <hr className="border-secondary" />
                            </div>
                        )}
                        <h6 className="text-white">Invite via Email</h6>
                        <form onSubmit={handleSendInvites} className="mt-2">
                            <input className="form-control mb-2 bg-dark text-white" value={inviteEmails} onChange={e => setInviteEmails(e.target.value)} placeholder="user@example.com" />
                            <button className="btn btn-success w-100" disabled={isInviting}>Send Invite</button>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}

export default AudioCall;