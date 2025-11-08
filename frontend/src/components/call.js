// src/components/Call.js

import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import { useParams, useNavigate } from 'react-router-dom';
import { db } from '../firebaseConfig';
import {
    doc, onSnapshot, updateDoc, collection, addDoc, query,
    orderBy, serverTimestamp, deleteDoc, deleteField
} from 'firebase/firestore';
import { toast } from 'react-toastify';
import Peer from 'simple-peer';


import SharingComponent from './SharingComponent';
import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.css';

function Call() {
    const { user } = useAuth();
    const { callId } = useParams();
    const navigate = useNavigate();

    // --- State Variables ---
    const heartbeatIntervalRef = useRef(null);
    const [messages, setMessages] = useState([]);
    const [newMessage, setNewMessage] = useState('');
    
    // -- Call State --
    const [callState, setCallState] = useState('loading');
    const [callData, setCallData] = useState(null);
    const [activeUsers, setActiveUsers] = useState([]);
    const [callOwnerId, setCallOwnerId] = useState(null);
    
    // --- UI State (NEW) ---
    // These control the mobile overlay panels
    const [isChatOpen, setIsChatOpen] = useState(false);
    const [isParticipantsOpen, setIsParticipantsOpen] = useState(false);
    const [isShareOpen, setIsShareOpen] = useState(false);

    // --- Voice/Video Chat State ---
    const [stream, setStream] = useState(null);
    const [muteStatus, setMuteStatus] = useState({});
    const peersRef = useRef({});
    const audioContainerRef = useRef(null);
    // localVideoRef (for self-view) has been removed
    const remoteVideoRef = useRef(null);
    const chatMessagesEndRef = useRef(null);

    // Auto-scroll chat
    useEffect(() => {
        chatMessagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    // Main useEffect to handle call data and user presence
    useEffect(() => {
        if (!callId || !user) {
            setCallState(callId ? 'loading' : 'denied');
            return;
        }

        const callDocRef = doc(db, 'calls', callId);

        const updatePresence = () => {
            updateDoc(callDocRef, {
                [`activeParticipants.${user._id}`]: {
                    name: `${user.firstname} ${user.lastname}`,
                    lastSeen: serverTimestamp()
                }
            }).catch(console.error);
        };
        updatePresence(); 
        heartbeatIntervalRef.current = setInterval(updatePresence, 30000);

        const unsubscribeCall = onSnapshot(callDocRef, (docSnap) => {
            if (!docSnap.exists()) {
                setCallState('denied');
                return;
            }

            const data = docSnap.data();
            setCallData(data); 
            setCallOwnerId(data.ownerId);

            const isOwner = user && data.ownerId === user._id;
            const hasAccess = (user && data.allowedEmails?.includes(user.email)) || isOwner;

            if (!hasAccess) {
                setCallState('denied');
                return;
            }

            const participantsMap = data.activeParticipants || {};
            const oneMinuteAgo = Date.now() - 60000;

            const currentUsers = Object.entries(participantsMap)
                .filter(([_, userData]) => userData.lastSeen && userData.lastSeen.toDate().getTime() > oneMinuteAgo)
                .map(([userId, userData]) => ({
                    id: userId,
                    name: userData.name,
                }));

            setActiveUsers(currentUsers);
            setMuteStatus(data.muteStatus || {});

            if (callState === 'loading') {
                setCallState('joining');
            }
        }, (error) => {
            console.error("Error in onSnapshot listener:", error);
            setCallState('denied');
        });

        const messagesQuery = query(collection(db, 'calls', callId, 'messages'), orderBy('timestamp'));
        const unsubscribeMessages = onSnapshot(messagesQuery, qSnap => setMessages(qSnap.docs.map(d => ({ id: d.id, ...d.data() }))));

        return () => {
            clearInterval(heartbeatIntervalRef.current); 
            if (user) {
                updateDoc(doc(db, 'calls', callId), {
                    [`activeParticipants.${user._id}`]: deleteField()
                }).catch(console.error);
            }
            if (stream) { stream.getTracks().forEach(track => track.stop()); }
            Object.values(peersRef.current).forEach(peer => peer.destroy());
            unsubscribeCall();
            unsubscribeMessages();
        };
    }, [callId, user, callState === 'loading']); // eslint-disable-line react-hooks/exhaustive-deps

    // useEffect for WebRTC connections
    useEffect(() => {
        if (!stream || callState !== 'active' || !user) return;

        const signalingColRef = collection(db, 'calls', callId, 'signaling');

        const createPeer = (recipientId, senderId, stream) => {
            const peer = new Peer({ initiator: true, trickle: false, stream });
            peer.on('signal', signal => addDoc(signalingColRef, { recipientId, senderId, signal }));
            peer.on('stream', remoteStream => {
                if (remoteVideoRef.current) {
                    remoteVideoRef.current.srcObject = remoteStream;
                }
                if (audioContainerRef.current) {
                    let audio = document.getElementById(`audio-${recipientId}`);
                    if (!audio) {
                        audio = document.createElement('audio'); audio.id = `audio-${recipientId}`;
                        audio.autoplay = true; audioContainerRef.current.appendChild(audio);
                    }
                    audio.srcObject = remoteStream;
                }
            });
            peer.on('close', () => { 
                const audioElem = document.getElementById(`audio-${recipientId}`); 
                if (audioElem) audioElem.remove();
                if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
            });
            return peer;
        };

        const addPeer = (incoming, recipientId, stream) => {
            const peer = new Peer({ initiator: false, trickle: false, stream });
            peer.on('signal', signal => addDoc(signalingColRef, { recipientId: incoming.senderId, senderId: recipientId, signal }));
            peer.on('stream', remoteStream => {
                 if (remoteVideoRef.current) {
                    remoteVideoRef.current.srcObject = remoteStream;
                }
                if (audioContainerRef.current) {
                    let audio = document.getElementById(`audio-${incoming.senderId}`);
                    if (!audio) {
                        audio = document.createElement('audio'); audio.id = `audio-${incoming.senderId}`;
                        audio.autoplay = true; audioContainerRef.current.appendChild(audio);
                    }
                    audio.srcObject = remoteStream;
                }
            });
            peer.on('close', () => { 
                const audioElem = document.getElementById(`audio-${incoming.senderId}`); 
                if (audioElem) audioElem.remove();
                if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
            });
            peer.signal(incoming.signal);
            return peer;
        };

        activeUsers.forEach(p => { if (p.id !== user._id && !peersRef.current[p.id]) { peersRef.current[p.id] = createPeer(p.id, user._id, stream); } });
        Object.keys(peersRef.current).forEach(peerId => { if (!activeUsers.find(p => p.id === peerId)) { peersRef.current[peerId].destroy(); delete peersRef.current[peerId]; } });

        const unsubscribeSignaling = onSnapshot(query(signalingColRef), snapshot => {
            snapshot.docChanges().forEach(change => {
                if (change.type === "added") {
                    const data = change.doc.data();
                    if (data.recipientId === user._id) {
                        const peer = peersRef.current[data.senderId];
                        if (peer) { peer.signal(data.signal); } else { peersRef.current[data.senderId] = addPeer(data, user._id, stream); }
                        deleteDoc(change.doc.ref);
                    }
                }
            });
        });
        return () => unsubscribeSignaling();
    }, [stream, activeUsers, callState, callId, user]);
    
    // Self-view useEffect has been removed

    // Mute Status UseEffect
    useEffect(() => {
        if (!stream || !user || stream.getAudioTracks().length === 0) { return; }
        const isMuted = muteStatus[user._id] ?? true;
        const audioTrack = stream.getAudioTracks()[0];
        audioTrack.enabled = !isMuted;
        Object.values(peersRef.current).forEach(peer => {
            const sender = peer._pc.getSenders().find(s => s.track?.kind === 'audio');
            if (sender) { sender.replaceTrack(audioTrack); }
        });
    }, [muteStatus, stream, user]);

    // --- Handler Functions ---

    const handleAcceptCall = async () => {
        try {
            const userStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            setStream(userStream);
            await updateDoc(doc(db, 'calls', callId), { [`muteStatus.${user._id}`]: false });
            setCallState('active'); 
        } catch (err) {
            toast.error("Could not access camera/microphone. Please check permissions.");
            console.error(err);
        }
    };

    const handleDeclineCall = () => {
        navigate(-1); 
    };
    
    // Hangup: Navigate to dashboard
    const handleHangUp = () => {
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
        }
        setStream(null);
        Object.values(peersRef.current).forEach(peer => peer.destroy());
        peersRef.current = {};
        navigate('/new-call'); // Go to dashboard
    };

    const handleToggleMute = async (targetUserId) => {
        const isTrueOwner = user && user._id === callOwnerId;
        const isSelf = targetUserId === user._id;

        if (isTrueOwner) {
            const currentMuteState = muteStatus[targetUserId] ?? true;
            const newMuteState = !currentMuteState;
            await updateDoc(doc(db, 'calls', callId), { [`muteStatus.${targetUserId}`]: newMuteState });
            return;
        }

        if (isSelf) {
            const isCurrentlyMuted = muteStatus[targetUserId] ?? true;
            if (isCurrentlyMuted) {
                toast.error("Only the call host can unmute you.");
                return;
            }
            await updateDoc(doc(db, 'calls', callId), { [`muteStatus.${targetUserId}`]: true });
        } else {
            toast.error("You do not have permission to mute other participants.");
        }
    };

    const formatTimestamp = (timestamp) => !timestamp ? '' : timestamp.toDate().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

    const handleSendMessage = async (e) => {
        e.preventDefault();
        if (!user || newMessage.trim() === '') return;
        await addDoc(collection(db, 'calls', callId, 'messages'), { text: newMessage, senderName: `${user.firstname} ${user.lastname}`, senderId: user._id, timestamp: serverTimestamp() });
        setNewMessage('');
    };

    // --- Render Functions ---

    if (callState === 'loading') {
        return (
            <div className="d-flex justify-content-center align-items-center vh-100" style={{ backgroundColor: '#12121c' }}>
                <div className="text-center">
                    <div className="spinner-border text-primary mb-3" style={{ width: '3rem', height: '3rem' }} role="status">
                        <span className="visually-hidden">Loading...</span>
                    </div>
                    <h4 className="text-white">Loading Call...</h4>
                </div>
            </div>
        );
    }

    if (callState === 'denied') {
        return (
            <>
               
                <div className="container mt-5">
                    <div className="alert alert-danger"><b>Access Denied.</b> This call may not exist or you may not have permission to join.</div>
                </div>
            </>
        );
    }
    
    if (callState === 'joining') {
        const callerName = callData?.ownerName || 'Unknown Caller';
        return (
            <>
                {/* --- Pulsing Animation --- */}
                <style jsx>{`
                    .pulse-button {
                        animation: pulse 1.5s infinite;
                        box-shadow: 0 0 0 0 rgba(255, 255, 255, 0.4);
                    }
                    .pulse-button.decline {
                        animation-delay: 0.5s;
                    }
                    @keyframes pulse {
                        0% {
                            transform: scale(0.95);
                            box-shadow: 0 0 0 0 rgba(255, 255, 255, 0.7);
                        }
                        70% {
                            transform: scale(1);
                            box-shadow: 0 0 0 15px rgba(255, 255, 255, 0);
                        }
                        100% {
                            transform: scale(0.95);
                            box-shadow: 0 0 0 0 rgba(255, 255, 255, 0);
                        }
                    }
                `}</style>
                <div className="d-flex flex-column justify-content-between align-items-center vh-100" style={{ backgroundColor: '#2b2b2b', color: 'white', padding: '10vh 0' }}>
                    <div className="text-center">
                        <h1 className="display-4">{callerName}</h1>
                        <h3 className="text-muted">{callData?.description || 'Incoming Call...'}</h3>
                    </div>

                    <div className="d-flex justify-content-around w-100" style={{ maxWidth: '400px' }}>
                        <div className="text-center">
                            <button 
                                className="btn btn-danger btn-lg rounded-circle pulse-button decline" 
                                style={{ width: '70px', height: '70px', fontSize: '1.8rem' }}
                                onClick={handleDeclineCall}
                            >
                                <i className="bi bi-telephone-fill" style={{ transform: 'rotate(135deg)' }}></i>
                            </button>
                            <div className="mt-2">Decline</div>
                        </div>
                        <div className="text-center">
                            <button 
                                className="btn btn-success btn-lg rounded-circle pulse-button" 
                                style={{ width: '70px', height: '70px', fontSize: '1.8rem' }}
                                onClick={handleAcceptCall}
                            >
                                <i className="bi bi-telephone-fill"></i>
                            </button>
                            <div className="mt-2">Accept</div>
                        </div>
                    </div>
                </div>
            </>
        );
    }

    // RENDER: Active Call UI
    return (
        <>
            
            
            <div className="chat-page-container">
                <style jsx>{`
                    /* --- 1. General Page & Layout Styles --- */
                    :root {
                      --dark-bg-primary: #12121c;
                      --dark-bg-secondary: #1e1e2f;
                      --border-color: #3a3a5a;
                      --text-primary: #e0e0e0;
                      --text-secondary: #a9a9b3;
                      --accent-blue: #4a69bd;
                    }
                    .chat-page-container {
                      background-color: var(--dark-bg-primary);
                      color: var(--text-primary);
                      min-height: calc(100vh - 56px); /* 56px is navbar height */
                      padding: 0;
                    }
                    
                    /* --- 2. Card Component Overrides (for desktop/panels) --- */
                    .card {
                      background-color: var(--dark-bg-secondary);
                      border: 1px solid var(--border-color);
                    }
                    .card-header, .card-footer {
                      background-color: rgba(0, 0, 0, 0.2);
                      border-bottom: 1px solid var(--border-color);
                      font-weight: 600;
                      color: var(--text-primary);
                    }
                    .list-group-item {
                      background-color: transparent;
                      border-bottom: 1px solid var(--border-color);
                      color: var(--text-primary);
                    }

                    /* --- 3. VIDEO PANEL (MOBILE) --- */
                    .video-panel-container {
                        position: relative;
                        width: 100%;
                        height: calc(100vh - 56px); /* Full height minus navbar */
                        background-color: #000;
                        overflow: hidden;
                    }
                    .remote-video {
                        width: 100%;
                        height: 100%;
                        object-fit: cover;
                    }
                    
                    /* LOCAL VIDEO (SELF-VIEW) IS REMOVED */

                    .call-controls {
                        position: absolute;
                        bottom: 2rem;
                        left: 50%;
                        transform: translateX(-50%);
                        background-color: rgba(0, 0, 0, 0.7);
                        border-radius: 50px;
                        padding: 0.5rem;
                        display: flex;
                        gap: 0.5rem;
                        z-index: 20;
                    }
                    .call-controls .btn {
                        width: 45px;
                        height: 45px;
                        font-size: 1.1rem;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        margin: 0 0.25rem;
                    }
                    
                    /* --- 4. MOBILE OVERLAY PANELS (WhatsApp-like) --- */
                    .mobile-panel {
                        position: fixed;
                        top: 0;
                        left: 0;
                        width: 100%;
                        height: 100%;
                        background-color: var(--dark-bg-primary);
                        z-index: 100;
                        display: flex;
                        flex-direction: column;
                        padding-top: 56px; /* Space for navbar */
                    }
                    .mobile-panel-header {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        padding: 1rem;
                        border-bottom: 1px solid var(--border-color);
                        background-color: var(--dark-bg-secondary);
                    }
                    .mobile-panel-header h5 { margin: 0; }
                    .mobile-panel-body {
                        flex-grow: 1;
                        overflow-y: auto;
                        padding: 1rem;
                    }
                    .mobile-chat-panel { padding: 0; }
                    .mobile-chat-body {
                        display: flex;
                        flex-direction: column;
                        height: calc(100vh - 56px - 61px); /* Full - nav - header */
                        padding: 0;
                        overflow: hidden;
                    }
                    .mobile-messages-container {
                        flex-grow: 1;
                        overflow-y: auto; /* SCROLLBAR */
                        padding: 1rem;
                    }
                    .mobile-chat-form {
                        padding: 1rem;
                        border-top: 1px solid var(--border-color);
                        background-color: var(--dark-bg-secondary);
                        flex-shrink: 0;
                    }


                    /* --- 5. DESKTOP VIEW (PC) --- */
                    @media (min-width: 992px) { 
                        .chat-page-container {
                            padding: 1.5rem 0;
                        }
                        .video-panel-container {
                            height: 80vh; /* <-- INCREASED HEIGHT */
                            border-radius: 8px;
                            border: 1px solid var(--border-color);
                        }
                        
                        /* LOCAL VIDEO (SELF-VIEW) IS REMOVED FOR DESKTOP */

                        .call-controls .btn {
                            width: 50px;
                            height: 50px;
                            font-size: 1.2rem;
                            margin: 0 0.5rem;
                        }
                        .call-controls {
                            padding: 0.5rem 1rem;
                            gap: 1rem;
                        }
                    }

                    /* --- 6. CHAT STYLES (Used by both) --- */
                    
                    /* --- FIX 1: DESKTOP CHAT SCROLLING --- */
                    .chat-card {
                        flex-grow: 1;
                        display: flex;
                        flex-direction: column;
                        min-height: 0; /* Flexbox trick */
                    }
                    .chat-card .card-body {
                        padding: 0.5rem 1rem;
                        overflow: hidden; /* CRITICAL */
                        display: flex;
                        flex-direction: column;
                        flex-grow: 1;
                    }
                    .chat-messages-container {
                        flex-grow: 1; /* Make message list fill the body */
                        overflow-y: auto; /* CRITICAL: Add scrollbar */
                        min-height: 0; /* Flexbox trick */
                        display: flex;
                        flex-direction: column;
                        padding: 0.5rem 0.5rem 0.5rem 0; /* Add padding for scrollbar */
                    }
                    .chat-form {
                        flex-shrink: 0;
                        margin-top: 0.75rem;
                    }
                    /* --- END FIX 1 --- */

                    /* --- CUSTOM SCROLLBAR (as requested) --- */
                    .chat-messages-container::-webkit-scrollbar {
                        width: 8px;
                    }
                    .chat-messages-container::-webkit-scrollbar-track {
                        background: var(--dark-bg-secondary);
                    }
                    .chat-messages-container::-webkit-scrollbar-thumb {
                        background-color: #555;
                        border-radius: 4px;
                        border: 2px solid var(--dark-bg-secondary);
                    }
                    .chat-messages-container::-webkit-scrollbar-thumb:hover {
                        background-color: #777;
                    }
                    /* --- END CUSTOM SCROLLBAR --- */


                    .chat-message { margin-bottom: 1rem; display: flex; flex-direction: column; }
                    .message-header { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.3rem; }
                    .message-sender { font-weight: 600; font-size: 0.85rem; color: var(--text-primary); }
                    .message-timestamp { font-size: 0.7rem; color: var(--text-secondary); }
                    .message-bubble { padding: 0.6rem 1.1rem; border-radius: 18px; max-width: 85%; word-wrap: break-word; line-height: 1.4; }
                    .own-message { align-items: flex-end; }
                    .own-message .message-bubble { background-color: var(--accent-blue); color: #ffffff; border-top-right-radius: 4px; }
                    .own-message .message-header { justify-content: flex-end; }
                    .other-message { align-items: flex-start; }
                    .other-message .message-bubble { background-color: #313147; color: var(--text-primary); border-top-left-radius: 4px; }
                    .form-control {
                      background-color: var(--dark-bg-primary) !important;
                      border: 1px solid var(--border-color) !important;
                      color: var(--text-primary) !important;
                    }
                    .form-control::placeholder { color: var(--text-secondary) !important; }
                    .chat-input { border-radius: 20px; padding: 0.5rem 1rem; }
                    .send-button {
                      background: var(--accent-blue); border: none; color: white;
                      border-radius: 50%; width: 40px; height: 40px;
                      display: flex; align-items: center; justify-content: center;
                      margin-left: 0.5rem; transition: background-color 0.2s ease;
                    }
                `}</style>

                <div className="row g-3 h-100">

                    {/* --- Video Column (Fullscreen Mobile, col-lg-8 Desktop) --- */}
                    <div className="col-12 col-lg-8 d-flex flex-column">
                        <div className="video-panel-container shadow-sm">
                            <video 
                                ref={remoteVideoRef} 
                                className="remote-video" 
                                autoPlay 
                                playsInline 
                                controls={false}
                            />
                            
                            {/* --- LOCAL VIDEO (SELF-VIEW) TAG IS REMOVED --- */}
                            
                            {/* --- Call Controls (Bottom Center) --- */}
                            <div className="call-controls">
                                {/* Mute Button */}
                                <button
                                    className={`btn rounded-circle ${muteStatus[user._id] ? 'btn-secondary' : 'btn-light'}`}
                                    onClick={() => handleToggleMute(user._id)}
                                    title={muteStatus[user._id] ? "Unmute" : "Mute"}
                                >
                                    <i className={`bi ${muteStatus[user._id] ? 'bi-mic-mute-fill' : 'bi-mic-fill'}`}></i>
                                </button>
                                
                                {/* Chat (MOBILE ONLY) */}
                                <button
                                    className="btn btn-primary rounded-circle d-lg-none"
                                    onClick={() => setIsChatOpen(true)}
                                    title="Show Chat"
                                >
                                    <i className="bi bi-chat-dots-fill"></i>
                                </button>
                                
                                {/* Participants (MOBILE ONLY) */}
                                <button
                                    className="btn btn-primary rounded-circle d-lg-none"
                                    onClick={() => setIsParticipantsOpen(true)}
                                    title="Show Participants"
                                >
                                    <i className="bi bi-people-fill"></i>
                                </button>

                                {/* Share (MOBILE ONLY) */}
                                <button
                                    className="btn btn-primary rounded-circle d-lg-none"
                                    onClick={() => setIsShareOpen(true)}
                                    title="Share Link"
                                >
                                    <i className="bi bi-share-fill"></i>
                                </button>

                                {/* Hangup Button */}
                                <button 
                                    className="btn btn-danger rounded-circle"
                                    onClick={handleHangUp}
                                    title="Hang Up"
                                >
                                    <i className="bi bi-telephone-fill" style={{ transform: 'rotate(135deg)' }}></i>
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* --- Desktop-Only Sidebar (d-none d-lg-flex) --- */}
                    <div className="col-lg-4 d-none d-lg-flex flex-column h-100">
                        {/* Participants Card (Desktop) */}
                        <div className="card shadow-sm mb-3">
                            <div className="card-header d-flex justify-content-between">
                                <span>Participants ({activeUsers.length})</span>
                                <i className="bi bi-broadcast text-success"></i>
                            </div>
                            <ul className="list-group list-group-flush">
                                {activeUsers.map(p => (
                                    <li key={p.id} className="list-group-item d-flex justify-content-between align-items-center">
                                        <div>
                                            <span className="fw-bold">{p.name}</span>
                                            {p.id === user?._id && <span className="ms-2 text-muted small">(You)</span>}
                                        </div>
                                        {stream && (
                                            <button
                                                className={`btn btn-sm ${muteStatus[p.id] ?? true ? 'text-danger' : 'text-success'}`}
                                                onClick={() => handleToggleMute(p.id)}
                                                disabled={user?._id !== callOwnerId && (p.id !== user?._id || (muteStatus[p.id] ?? true))}
                                                style={{ fontSize: '1.2rem' }}
                                            >
                                                <i className={`bi ${muteStatus[p.id] ?? true ? 'bi-mic-mute-fill' : 'bi-mic-fill'}`}></i>
                                            </button>
                                        )}
                                    </li>
                                ))}
                            </ul>
                            <div ref={audioContainerRef} style={{ display: 'none' }}></div>
                        </div>

                        {/* Share Card (Desktop) */}
                        <div className="mb-3"><SharingComponent sessionId={callId} /></div>

                        {/* Chat Card (Desktop) */}
                        <div className="card shadow-sm flex-grow-1 chat-card">
                            <div className="card-header">Live Chat</div>
                            <div className="card-body">
                                <div className="chat-messages-container">
                                    {messages.map(msg => (
                                        <div key={msg.id} className={`chat-message ${msg.senderId === user?._id ? 'own-message' : 'other-message'}`}>
                                            <div className="message-header">
                                                <span className="message-sender">{msg.senderName}</span>
                                                <span className="message-timestamp">{formatTimestamp(msg.timestamp)}</span>
                                            </div>
                                            <div className="message-bubble">{msg.text}</div>
                                        </div>
                                    ))}
                                    <div ref={chatMessagesEndRef} />
                                </div>
                                <form onSubmit={handleSendMessage} className="chat-form">
                                    <div className="d-flex align-items:center">
                                        <input
                                            type="text"
                                            className="form-control chat-input"
                                            placeholder="Type a message..."
                                            value={newMessage}
                                            onChange={(e) => setNewMessage(e.target.value)}
                                        />
                                        <button className="send-button flex-shrink-0" type="submit" disabled={!newMessage.trim()}>
                                            <i className="bi bi-send-fill"></i>
                                        </button>
                                    </div>
                                </form>
                            </div>
                        </div>
                    </div>
                </div>

                {/* --- Mobile-Only Panels (Overlays) --- */}

                {/* Participants Panel (Mobile) */}
                {isParticipantsOpen && (
                    <div className="mobile-panel d-lg-none">
                        <div className="mobile-panel-header">
                            <h5>Participants ({activeUsers.length})</h5>
                            <button className="btn-close btn-close-white" onClick={() => setIsParticipantsOpen(false)}></button>
                        </div>
                        <div className="mobile-panel-body">
                            <ul className="list-group list-group-flush">
                                {activeUsers.map(p => (
                                    <li key={p.id} className="list-group-item d-flex justify-content-between align-items-center">
                                        <div>
                                            <span className="fw-bold">{p.name}</span>
                                            {p.id === user?._id && <span className="ms-2 text-muted small">(You)</span>}
                                        </div>
                                        {stream && (
                                            <button
                                                className={`btn btn-sm ${muteStatus[p.id] ?? true ? 'text-danger' : 'text-success'}`}
                                                onClick={() => handleToggleMute(p.id)}
                                                disabled={user?._id !== callOwnerId && (p.id !== user?._id || (muteStatus[p.id] ?? true))}
                                                style={{ fontSize: '1.2rem' }}
                                            >
                                                <i className={`bi ${muteStatus[p.id] ?? true ? 'bi-mic-mute-fill' : 'bi-mic-fill'}`}></i>
                                            </button>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>
                )}

                {/* Share Panel (Mobile) */}
                {isShareOpen && (
                    <div className="mobile-panel d-lg-none">
                        <div className="mobile-panel-header">
                            <h5>Share Call Link</h5>
                            <button className="btn-close btn-close-white" onClick={() => setIsShareOpen(false)}></button>
                        </div>
                        <div className="mobile-panel-body">
                            <SharingComponent sessionId={callId} />
                        </div>
                    </div>
                )}

                {/* Chat Panel (Mobile) */}
                {isChatOpen && (
                    <div className="mobile-panel mobile-chat-panel d-lg-none">
                        <div className="mobile-panel-header">
                            <h5>Live Chat</h5>
                            <button className="btn-close btn-close-white" onClick={() => setIsChatOpen(false)}></button>
                        </div>
                        <div className="mobile-chat-body">
                            <div className="mobile-messages-container">
                                {messages.map(msg => (
                                    <div key={msg.id} className={`chat-message ${msg.senderId === user?._id ? 'own-message' : 'other-message'}`}>
                                        <div className="message-header">
                                            <span className="message-sender">{msg.senderName}</span>
                                            <span className="message-timestamp">{formatTimestamp(msg.timestamp)}</span>
                                        </div>
                                        <div className="message-bubble">{msg.text}</div>
                                    </div>
                                ))}
                                <div ref={chatMessagesEndRef} />
                            </div>
                            <form onSubmit={handleSendMessage} className="mobile-chat-form">
                                <div className="d-flex align-items:center">
                                    <input
                                        type="text"
                                        className="form-control chat-input"
                                        placeholder="Type a message..."
                                        value={newMessage}
                                        onChange={(e) => setNewMessage(e.target.value)}
                                    />
                                    <button className="send-button flex-shrink-0" type="submit" disabled={!newMessage.trim()}>
                                        <i className="bi bi-send-fill"></i>
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                )}
            </div>
        </>
    );
}

export default Call;