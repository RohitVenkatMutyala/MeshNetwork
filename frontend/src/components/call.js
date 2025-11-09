import React, { 
    useState, 
    useEffect, 
    useRef, 
    useLayoutEffect 
} from 'react';
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
import Navbar from './navbar';

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
    
    // --- UI State ---
    const [isChatOpen, setIsChatOpen] = useState(false);
    const [isParticipantsOpen, setIsParticipantsOpen] = useState(false);
    const [isShareOpen, setIsShareOpen] = useState(false);
    const [areControlsVisible, setAreControlsVisible] = useState(true);

    // --- Voice/Video Chat State ---
    const [stream, setStream] = useState(null);
    const [muteStatus, setMuteStatus] = useState({});
    const [isVideoOn, setIsVideoOn] = useState(true);
    const [facingMode, setFacingMode] = useState('user'); // <-- NEW: 'user' (front) or 'environment' (back)
    const [hasMultipleCameras, setHasMultipleCameras] = useState(false); // <-- NEW: To show/hide swap button
    const peersRef = useRef({});
    const audioContainerRef = useRef(null);
    const remoteVideoRef = useRef(null);
    const localVideoRef = useRef(null); // Ref for PiP video
    const chatMessagesEndRef = useRef(null);
    
    // --- Draggable PiP State ---
    const [isPipDragging, setIsPipDragging] = useState(false);
    const pipOffsetRef = useRef({ x: 0, y: 0 });


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
    
    // Mute Status UseEffect
    useEffect(() => {
        if (!stream || !user || !stream.getAudioTracks().length) { return; }
        const isMuted = muteStatus[user._id] ?? false;
        stream.getAudioTracks()[0].enabled = !isMuted;
    }, [muteStatus, stream, user]);

    // Video Toggle UseEffect
    useEffect(() => {
        if (!stream || !stream.getVideoTracks().length) return;
        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.enabled = isVideoOn;
        }
    }, [isVideoOn, stream]);


    // --- *** CORRECTED *** ---
    // Switched to useLayoutEffect. This runs *before* the browser paints,
    // guaranteeing the localVideoRef.current element is ready.
    useLayoutEffect(() => {
        // We must wait for THREE things:
        // 1. The stream to be ready (stream)
        // 2. The call state to be 'active' (which renders the <video> tag)
        // 3. The ref to that <video> tag to be populated (localVideoRef.current)
        if (localVideoRef.current && stream && callState === 'active') {
            localVideoRef.current.srcObject = stream;
        }
    }, [stream, callState]); // <-- FIX: Re-run when callState changes to 'active'


    // --- Handler Functions ---

   const handleAcceptCall = async () => {
        try {
            // <-- MODIFIED: Be explicit about 'user' (front) camera
            const userStream = await navigator.mediaDevices.getUserMedia({ 
                video: { facingMode: 'user' }, 
                audio: true 
            });
            setFacingMode('user'); // <-- NEW: Set initial state
            
            // <-- NEW: Check for multiple cameras non-blockingly
            navigator.mediaDevices.enumerateDevices().then(devices => {
                const videoDevices = devices.filter(d => d.kind === 'videoinput');
                if (videoDevices.length > 1) {
                    setHasMultipleCameras(true);
                }
            }).catch(console.error);
            // --- End New Block ---

            // First, perform the async database operation
            await updateDoc(doc(db, 'calls', callId), { 
                [`muteStatus.${user._id}`]: false
            });

            // NOW, set all state updates together.
            // React will batch these into a single render.
            setStream(userStream); 
            setIsVideoOn(true);
            setCallState('active'); // This makes the <video> element appear
        } catch (err) {
            toast.error("Could not access camera/microphone. Please check permissions.");
            console.error(err);
        }
    };

    const handleDeclineCall = () => {
        navigate(-1); 
    };
    
    const handleHangUp = () => {
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
        }
        setStream(null); // This will trigger the useLayoutEffect to clear the PiP video
        Object.values(peersRef.current).forEach(peer => peer.destroy());
        peersRef.current = {};
        navigate('/new-call');
    };

    const handleToggleVideo = () => {
        if (!stream) return;
        const newVideoState = !isVideoOn;
        setIsVideoOn(newVideoState);
    };

    // --- NEW: Camera Swap Function ---
  // --- NEW: Camera Swap Function ---
    const handleSwapCamera = async () => {
        // Ensure stream exists, has a video track, and there are multiple cameras
        if (!stream || !stream.getVideoTracks().length || !hasMultipleCameras) return;

        const oldVideoTrack = stream.getVideoTracks()[0];
        const newFacingMode = facingMode === 'user' ? 'environment' : 'user';

        try {
            // 1. Get ONLY the new video stream
            const newVideoStream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: newFacingMode }
            });
            const newVideoTrack = newVideoStream.getVideoTracks()[0];

            // 2. Replace the track in all peer connections
            Object.values(peersRef.current).forEach(peer => {
                peer.replaceTrack(oldVideoTrack, newVideoTrack, stream);
            });

            // 3. Update the *local* stream object in-place
            stream.removeTrack(oldVideoTrack);
            stream.addTrack(newVideoTrack);
            
            // 4. Stop the old track
            oldVideoTrack.stop();

            // 5. --- THE FIX ---
            // Force the <video> element to refresh, as some
            // browsers don't auto-update on track changes.
            if (localVideoRef.current) {
                localVideoRef.current.srcObject = null; // Unset it
                localVideoRef.current.srcObject = stream; // Re-set it
            }
            // --- END FIX ---

            // 6. Update state
            setFacingMode(newFacingMode);
            // Manually set the new track's enabled status to match UI state
            newVideoTrack.enabled = isVideoOn; 

        } catch (err) {
            toast.error("Could not swap camera.");
            console.error("Error swapping camera: ", err);
        }
    };
    // --- End New Function ---
    // --- End New Function ---


    const handleToggleMute = async (targetUserId) => {
        const isSelf = targetUserId === user._id;

        if (isSelf) {
            const currentMuteState = muteStatus[targetUserId] ?? false;
            const newMuteState = !currentMuteState;
            await updateDoc(doc(db, 'calls', callId), { 
                [`muteStatus.${targetUserId}`]: newMuteState 
            });
        } else {
            const isTrueOwner = user && user._id === callOwnerId;
            if (isTrueOwner) {
                await updateDoc(doc(db, 'calls', callId), { 
                    [`muteStatus.${targetUserId}`]: true 
                });
                toast.success("Muted participant");
            } else {
                toast.error("You can only mute yourself.");
            }
        }
    };

    const formatTimestamp = (timestamp) => !timestamp ? '' : timestamp.toDate().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

    const handleSendMessage = async (e) => {
        e.preventDefault();
        if (!user || newMessage.trim() === '') return;
        await addDoc(collection(db, 'calls', callId, 'messages'), { text: newMessage, senderName: `${user.firstname} ${user.lastname}`, senderId: user._id, timestamp: serverTimestamp() });
        setNewMessage('');
    };

    // --- PiP Drag Handlers (using localVideoRef) ---
    const handlePipMouseDown = (e) => {
        if (!localVideoRef.current) return;
        setIsPipDragging(true);
        pipOffsetRef.current = {
            x: e.clientX - localVideoRef.current.getBoundingClientRect().left,
            y: e.clientY - localVideoRef.current.getBoundingClientRect().top,
        };
        localVideoRef.current.style.cursor = 'grabbing';
    };

    const handlePipMouseUp = () => {
        setIsPipDragging(false);
        if (localVideoRef.current) {
            localVideoRef.current.style.cursor = 'move';
        }
    };

    const handlePipMouseMove = (e) => {
        if (!isPipDragging || !localVideoRef.current || !localVideoRef.current.parentElement) return; 
        
        const parentRect = localVideoRef.current.parentElement.getBoundingClientRect();
        let newX = e.clientX - parentRect.left - pipOffsetRef.current.x;
        let newY = e.clientY - parentRect.top - pipOffsetRef.current.y;

        // Constrain to parent
        newX = Math.max(0, Math.min(newX, parentRect.width - localVideoRef.current.offsetWidth));
        newY = Math.max(0, Math.min(newY, parentRect.height - localVideoRef.current.offsetHeight));

        localVideoRef.current.style.left = `${newX}px`;
        localVideoRef.current.style.top = `${newY}px`;
        localVideoRef.current.style.bottom = 'auto';
        localVideoRef.current.style.right = 'auto';
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
                <Navbar />
                <style jsx>{`
                    .joining-screen {
                        background-color: #2b2b2b;
                        color: white;
                    }
                    .caller-info {
                        text-align: center;
                    }
                    .caller-name {
                        font-size: 2.5rem;
                        font-weight: 500;
                        margin-bottom: 0.25rem;
                    }
                    .caller-id {
                        font-size: 1.5rem;
                        color: #aaa;
                    }
                    .call-actions {
                        display: flex;
                        justify-content: space-around;
                        width: 100%;
                        max-width: 300px;
                        margin-top: 5rem;
                    }
                    .action-button {
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        text-decoration: none;
                        color: white;
                        font-weight: 500;
                    }
                    .button-circle {
                        width: 70px;
                        height: 70px;
                        border-radius: 50%;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        font-size: 1.8rem;
                        margin-bottom: 0.5rem;
                        position: relative;
                        background-color: rgba(255, 255, 255, 0.1);
                    }
                    .button-circle.accept {
                        background-color: #28a745;
                    }
                    .button-circle.decline {
                        background-color: #dc3545;
                    }
                    
                    /* New Ripple Animation */
                    .button-circle::before, .button-circle::after {
                        content: '';
                        position: absolute;
                        border-radius: 50%;
                        z-index: -1;
                        top: 0;
                        left: 0;
                        width: 100%;
                        height: 100%;
                        animation: ripple 2s infinite ease-out;
                    }
                    .button-circle.accept::before, .button-circle.accept::after {
                        background-color: #28a745;
                    }
                    .button-circle.decline::before, .button-circle.decline::after {
                        background-color: #dc3545;
                    }
                    .button-circle::after {
                        animation-delay: 0.5s;
                    }

                    @keyframes ripple {
                        0% {
                            transform: scale(1);
                            opacity: 0.6;
                        }
                        100% {
                            transform: scale(1.7);
                            opacity: 0;
                        }
                    }
                `}</style>
                <div className="d-flex flex-column justify-content-around align-items-center vh-100 joining-screen">
                    
                    <div className="caller-info">
                        <h1 className="caller-name">{callerName}</h1>
                        <h3 className="caller-id">{callData?.description || 'Incoming Call...'}</h3>
                    </div>

                    <div className="call-actions">
                        <div className="action-button">
                            <button 
                                className="button-circle decline"
                                onClick={handleDeclineCall}
                                aria-label="Decline"
                            >
                                <i className="bi bi-telephone-fill" style={{ transform: 'rotate(135deg)' }}></i>
                            </button>
                            <span>Decline</span>
                        </div>
                        <div className="action-button">
                            <button 
                                className="button-circle accept"
                                onClick={handleAcceptCall}
                                aria-label="Accept"
                            >
                                <i className="bi bi-telephone-fill"></i>
                            </button>
                            <span>Accept</span>
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

                    /* --- 3. VIDEO PANEL --- */
                    .video-panel-container {
                        position: relative;
                        width: 100%;
                        height: calc(100vh - 56px); /* Full height minus navbar */
                        background-color: #000;
                        overflow: hidden;
                        cursor: pointer; 
                    }
                    .remote-video {
                        width: 100%;
                        height: 100%;
                        object-fit: cover;
                    }
                    
                    /* --- Draggable Self-View (PiP) --- */
                    .local-video-pip {
                        position: absolute;
                        bottom: 1rem;
                        right: 1rem;
                        width: 150px;
                        height: 150px;
                        border-radius: 50%;
                        object-fit: cover;
                        border: 2px solid var(--border-color);
                        z-index: 10;
                        cursor: move;
                        transition: box-shadow 0.2s ease, opacity 0.3s ease;
                        background: #222; /* Placeholder color */
                        
                    }
                    /* --- MODIFIED: Hide if no stream --- */
                    .local-video-pip:not([style*="left"]) { /* A bit of a hack: if no 'left' style, it's not dragged */
                         bottom: 1rem;
                         right: 1rem;
                    }
                    .local-video-pip[style*="opacity: 0"] {
                         display: none;
                    }
                    .local-video-pip:active {
                        box-shadow: 0 0 15px 5px rgba(255, 255, 255, 0.3);
                        cursor: grabbing;
                    }

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
                        transition: opacity 0.3s ease; 
                    }
                    .call-controls.hidden { 
                        opacity: 0;
                        pointer-events: none;
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
                        flex-shrink: 0;
                    }
                    .mobile-panel-header h5 { margin: 0; }
                    .mobile-panel-body {
                        flex-grow: 1;
                        overflow-y: auto;
                        padding: 1rem;
                        min-height: 0;
                    }
                    
                    /* --- FIXED MOBILE CHAT LAYOUT --- */
                    .mobile-chat-panel { padding: 0; }
                    .mobile-chat-body {
                        display: flex;
                        flex-direction: column;
                        flex-grow: 1;
                        padding: 0;
                        overflow: hidden; /* CRITICAL */
                    }
                    .mobile-messages-container {
                        flex-grow: 1;
                        overflow-y: auto; /* SCROLLBAR */
                        padding: 1rem;
                        min-height: 0;
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
                            height: 80vh;
                            border-radius: 8px;
                            border: 1px solid var(--border-color);
                        }
                        
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
                    
                    .chat-card {
                        flex-grow: 1;
                        display: flex;
                        flex-direction: column;
                        min-height: 0; /* Flexbox trick */
                    }
                    .chat-card .card-body {
                        padding: 0; 
                        overflow: hidden; 
                        display: flex;
                        flex-direction: column;
                        flex-grow: 1;
                    }
                    .chat-messages-container {
                        flex-grow: 1; 
                        overflow-y: auto; 
                        min-height: 0;
                        display: flex;
                        flex-direction: column;
                        padding: 1rem; 
                    }
                    .chat-form {
                        flex-shrink: 0;
                        padding: 1rem;
                        border-top: 1px solid var(--border-color);
                        background-color: rgba(0,0,0,0.1);
                    }

                    /* --- Custom Scrollbar --- */
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

                    /* --- Message Bubbles --- */
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

                    {/* --- Video Column --- */}
                    <div className="col-12 col-lg-8 d-flex flex-column">
                        <div 
                            className="video-panel-container shadow-sm"
                            onClick={() => setAreControlsVisible(!areControlsVisible)} 
                            onMouseMove={handlePipMouseMove} 
                            onMouseUp={handlePipMouseUp} 
                            onMouseLeave={handlePipMouseUp} 
                        >
                            <video 
                                ref={remoteVideoRef} 
                                className="remote-video" 
                                autoPlay 
                                playsInline 
                                controls={false}
                            />
                            
                            {/* --- Self-View (PiP) --- */}
                            <video
                                ref={localVideoRef} 
                                className="local-video-pip"
                                // <-- MODIFIED: Add conditional transform for mirror effect
                                style={{ 
                                    opacity: stream ? 1 : 0,
                                    transform: facingMode === 'user' ? 'scaleX(-1)' : 'scaleX(1)'
                                }}
                                autoPlay
                                playsInline
                                muted
                                onMouseDown={handlePipMouseDown}
                                onClick={(e) => e.stopPropagation()} 
                            />
                            
                            {/* --- Call Controls --- */}
                            <div className={`call-controls ${!areControlsVisible ? 'hidden' : ''}`}>
                                
                                {/* --- NEW CAMERA SWAP BUTTON --- */}
                                {hasMultipleCameras && (
                                    <button
                                        className="btn btn-light rounded-circle" 
                                        onClick={(e) => { e.stopPropagation(); handleSwapCamera(); }} 
                                        title="Swap Camera"
                                    >
                                        <i className="bi bi-arrow-repeat"></i>
                                    </button>
                                )}
                                {/* --- END NEW BUTTON --- */}

                                <button
                                    className={`btn rounded-circle ${isVideoOn ? 'btn-light' : 'btn-danger'}`} 
                                    onClick={(e) => { e.stopPropagation(); handleToggleVideo(); }} 
                                    title={isVideoOn ? "Turn off camera" : "Turn on camera"}
                                >
                                    <i className={`bi ${isVideoOn ? 'bi-camera-video-fill' : 'bi-camera-video-off-fill'}`}></i>
                                </button>
                                
                                <button
                                    className={`btn rounded-circle ${muteStatus[user._id] ? 'btn-danger' : 'btn-light'}`} 
                                    onClick={(e) => { e.stopPropagation(); handleToggleMute(user._id); }} 
                                    title={muteStatus[user._id] ? "Unmute" : "Mute"}
                                >
                                    <i className={`bi ${muteStatus[user._id] ? 'bi-mic-mute-fill' : 'bi-mic-fill'}`}></i>
                                </button>
                                
                                {/* Chat (MOBILE ONLY) */}
                                <button
                                    className="btn btn-primary rounded-circle d-lg-none" 
                                    onClick={(e) => { e.stopPropagation(); setIsChatOpen(true); }} 
                                    title="Show Chat"
                                >
                                    <i className="bi bi-chat-dots-fill"></i>
                                </button>
                                
                                {/* Participants (MOBILE ONLY) */}
                                <button
                                    className="btn btn-primary rounded-circle d-lg-none" 
                                    onClick={(e) => { e.stopPropagation(); setIsParticipantsOpen(true); }} 
                                    title="Show Participants"
                                >
                                    <i className="bi bi-people-fill"></i>
                                </button>

                                {/* Share (MOBILE ONLY) */}
                                <button
                                    className="btn btn-primary rounded-circle d-lg-none" 
                                    onClick={(e) => { e.stopPropagation(); setIsShareOpen(true); }} 
                                    title="Share Link"
                                >
                                    <i className="bi bi-share-fill"></i>
                                </button>

                                {/* Hangup Button */}
                                <button 
                                    className="btn btn-danger rounded-circle"
                                    onClick={(e) => { e.stopPropagation(); handleHangUp(); }} 
                                    title="Hang Up"
                                >
                                    <i className="bi bi-telephone-fill" style={{ transform: 'rotate(135deg)' }}></i>
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* --- Desktop-Only Sidebar (d-none d-lg-flex) --- */}
                    <div className="col-lg-4 d-none d-lg-flex flex-column h-100" style={{maxHeight: '80vh', gap: '1.5rem'}}>
                        {/* Participants Card (Desktop) */}
                        <div className="card shadow-sm">
                            <div className="card-header d-flex justify-content-between">
                                <span>Participants ({activeUsers.length})</span>
                                <i className="bi bi-broadcast text-success"></i>
                            </div>
                            <ul className="list-group list-group-flush" style={{maxHeight: '150px', overflowY: 'auto'}}>
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
                                                disabled={user?._id !== callOwnerId && p.id !== user?._id}
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
                        <div><SharingComponent sessionId={callId} /></div>

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
                                                disabled={user?._id !== callOwnerId && p.id !== user?._id}
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
                                <div className="d-flex align-items-center">
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