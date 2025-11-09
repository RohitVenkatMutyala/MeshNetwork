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

// --- NEW: Quality Definitions ---
const QUALITY_PROFILES = {
    high: {
        video: {
            width: { ideal: 1920, max: 1920 },
            height: { ideal: 1080, max: 1080 },
            frameRate: { ideal: 30 }
        }
    },
    medium: {
        video: {
            width: { ideal: 1280, max: 1280 },
            height: { ideal: 720, max: 720 },
            frameRate: { ideal: 30 }
        }
    },
    low: {
        video: {
            width: { ideal: 640, max: 640 },
            height: { ideal: 360, max: 360 },
            frameRate: { ideal: 15 }
        }
    }
};

// --- NEW: SlideToActionButton Component ---
// This is a self-contained component for the "slide-to-action" button
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
            sliderRef.current.style.transition = 'none'; // Disable transition while dragging
            // --- NEW: Stop animation on drag ---
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
        
        // Constrain
        const maxLeft = containerRect.width - sliderRect.width - 2; // -2 for borders
        newLeft = Math.max(0, Math.min(newLeft, maxLeft));
        
        setSliderLeft(newLeft);

        // Check for unlock
        if (newLeft > maxLeft * 0.9) { // 90% threshold
            setUnlocked(true);
            setIsDragging(false);
            setSliderLeft(maxLeft); // Snap to end
            if (sliderRef.current) sliderRef.current.style.transition = 'left 0.3s ease-out';
            onAction();
        }
    };

    const handleDragEnd = () => {
        if (isDragging && !unlocked) {
            // Snap back to start
            setIsDragging(false);
            setSliderLeft(0);
            if (sliderRef.current) {
                sliderRef.current.style.transition = 'left 0.3s ease-out';
                // --- NEW: Re-start animation ---
                sliderRef.current.style.animation = 'vibrate 0.5s ease-in-out infinite 1.5s';
            }
        }
    };

    return (
        <div 
            className="slider-container" 
            ref={containerRef}
            onMouseMove={handleDragMove}
            onMouseUp={handleDragEnd}
            onMouseLeave={handleDragEnd}
            onTouchMove={handleDragMove}
            onTouchEnd={handleDragEnd}
        >
            <div 
                className={`slider-thumb ${colorClass}`}
                ref={sliderRef}
                style={{ left: `${sliderLeft}px` }}
                onMouseDown={handleDragStart}
                onTouchStart={handleDragStart}
            >
                <i className={`bi ${actionType === 'accept' ? 'bi-arrow-right' : 'bi-x-lg'}`}></i>
            </div>
            <div className="slider-text-overlay">
                <i className={`bi ${iconClass} me-2`}></i>
                {text}
            </div>
        </div>
    );
}


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
    // --- NEW: Quality Menu State ---
    const [isQualityMenuOpen, setIsQualityMenuOpen] = useState(false);


    // --- Voice/Video Chat State ---
    const [stream, setStream] = useState(null);
    const [muteStatus, setMuteStatus] = useState({});
    const [isVideoOn, setIsVideoOn] = useState(true);
    // --- REMOVED facingMode and hasMultipleCameras ---
    const peersRef = useRef({});
    const audioContainerRef = useRef(null);
    const remoteVideoRef = useRef(null);
    const localVideoRef = useRef(null); // Ref for PiP video
    const chatMessagesEndRef = useRef(null);
    // --- NEW: Quality State ---
    const [videoQuality, setVideoQuality] = useState('high'); // 'low', 'medium', 'high'
    
    // --- Draggable PiP State ---
    const [isPipDragging, setIsPipDragging] = useState(false);
    const pipOffsetRef = useRef({ x: 0, y: 0 });
    // --- NEW: Ref for PiP wrapper ---
    const pipWrapperRef = useRef(null);


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


    // Switched to useLayoutEffect. This runs *before* the browser paints,
    // guaranteeing the localVideoRef.current element is ready.
    useLayoutEffect(() => {
        if (localVideoRef.current && stream && callState === 'active') {
            localVideoRef.current.srcObject = stream;
        }
    }, [stream, callState]); // <-- Re-run when callState changes to 'active'


    // --- Handler Functions ---

    // --- MODIFIED: getQualityStream simplified (no facingMode) ---
    const getQualityStream = async (quality, requestVideo) => {
        const qualityLevels = ['high', 'medium', 'low'];
        // Start trying from the requested quality level down
        const levelsToTry = qualityLevels.slice(qualityLevels.indexOf(quality));

        let constraintsToTry = [];
        if (requestVideo) { // If user *wants* video
            constraintsToTry = levelsToTry.map(level => ({
                audio: true,
                ...QUALITY_PROFILES[level],
                video: {
                    ...QUALITY_PROFILES[level].video,
                    facingMode: 'user' // --- Hardcoded to 'user' ---
                }
            }));
        }
        
        // Add audio-only as the last resort, or if video is disabled
        constraintsToTry.push({ audio: true, video: false });
        
        for (const constraints of constraintsToTry) {
            try {
                const stream = await navigator.mediaDevices.getUserMedia(constraints);
                console.log(`Acquired stream with constraints:`, constraints);
                return stream; // Return the first one that works
            } catch (err) {
                console.warn(`Failed to get stream with constraints:`, constraints, err.name);
            }
        }

        throw new Error("Could not access camera/microphone with any constraints.");
    };

    // --- MODIFIED: Uses new getQualityStream with state ---
    const handleAcceptCall = async () => {
        try {
            // Use the quality from state, request video by default
            const userStream = await getQualityStream(videoQuality, true);
            // --- REMOVED setFacingMode and camera check logic ---
            
            await updateDoc(doc(db, 'calls', callId), { 
                [`muteStatus.${user._id}`]: false
            });

            setStream(userStream); 
            setIsVideoOn(true); // Video is on by default
            setCallState('active'); 
        } catch (err) {
            toast.error("Could not access camera/microphone.");
            console.error(err);
        }
    };

    // --- MODIFIED: Routing Fix ---
    const handleDeclineCall = () => {
        navigate('/new-call', { replace: true }); 
    };
    
    // --- MODIFIED: Routing Fix ---
    const handleHangUp = () => {
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
        }
        setStream(null); 
        Object.values(peersRef.current).forEach(peer => peer.destroy());
        peersRef.current = {};
        navigate('/new-call', { replace: true });
    };

    const handleToggleVideo = () => {
        if (!stream) return;
        const newVideoState = !isVideoOn;
        setIsVideoOn(newVideoState);
    };

    // --- MODIFIED: Function to change video quality during the call ---
    const handleChangeVideoQuality = async (newQuality) => {
        if (!stream || videoQuality === newQuality) return;

        setVideoQuality(newQuality);
        setIsQualityMenuOpen(false);
        const oldVideoTrack = stream.getVideoTracks()[0];

        try {
            // Get a new stream (video only) at the new quality
            // --- FIX: Always request video, even if isVideoOn is false ---
            const newTrackStream = await getQualityStream(newQuality, true);
            
            if (!newTrackStream.getVideoTracks().length) {
                // We wanted video but couldn't get it
                toast.error(`Could not get ${newQuality} video. Turning camera off.`);
                setIsVideoOn(false); // Turn off video
                if (oldVideoTrack) oldVideoTrack.stop(); // Stop the old track
                return;
            }

            const newVideoTrack = newTrackStream.getVideoTracks()[0];
            
            // Replace the track in all peer connections
            if(oldVideoTrack) {
                for (const peerId in peersRef.current) {
                    peersRef.current[peerId].replaceTrack(oldVideoTrack, newVideoTrack, stream);
                }
            }
            
            // Stop the old track to release the camera
            if (oldVideoTrack) oldVideoTrack.stop();
            
            // Update the local stream object in-place
            if (oldVideoTrack) stream.removeTrack(oldVideoTrack);
            stream.addTrack(newVideoTrack);

            // Force the <video> element to refresh
            if (localVideoRef.current) {
                localVideoRef.current.srcObject = null;
                localVideoRef.current.srcObject = stream;
            }
            
            // Ensure video enabled-state is consistent
            newVideoTrack.enabled = isVideoOn; 
            toast.success(`Video quality set to ${newQuality}`);

        } catch (err) {
            toast.error(`Failed to switch to ${newQuality} quality.`);
            console.error("Error changing quality: ", err);
        }
    };


    // --- REMOVED handleSwapCamera FUNCTION ---

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

    // --- PiP Drag Handlers (MODIFIED to use pipWrapperRef) ---
    const handlePipMouseDown = (e) => {
        if (!pipWrapperRef.current) return;
        setIsPipDragging(true);
        pipOffsetRef.current = {
            x: e.clientX - pipWrapperRef.current.getBoundingClientRect().left,
            y: e.clientY - pipWrapperRef.current.getBoundingClientRect().top,
        };
        pipWrapperRef.current.style.cursor = 'grabbing';
    };

    const handlePipMouseUp = () => {
        setIsPipDragging(false);
        if (pipWrapperRef.current) {
            pipWrapperRef.current.style.cursor = 'move';
        }
    };

    const handlePipMouseMove = (e) => {
        if (!isPipDragging || !pipWrapperRef.current || !pipWrapperRef.current.parentElement) return; 
        
        const parentRect = pipWrapperRef.current.parentElement.getBoundingClientRect();
        let newX = e.clientX - parentRect.left - pipOffsetRef.current.x;
        let newY = e.clientY - parentRect.top - pipOffsetRef.current.y;

        // Constrain to parent
        newX = Math.max(0, Math.min(newX, parentRect.width - pipWrapperRef.current.offsetWidth));
        newY = Math.max(0, Math.min(newY, parentRect.height - pipWrapperRef.current.offsetHeight));

        pipWrapperRef.current.style.left = `${newX}px`;
        pipWrapperRef.current.style.top = `${newY}px`;
        pipWrapperRef.current.style.bottom = 'auto';
        pipWrapperRef.current.style.right = 'auto';
    };


    // --- Render Functions ---

    if (callState === 'loading') {
        return (
            <div className="d-flex justify-content-center align-items-center" style={{ height: '100dvh', backgroundColor: '#12121c' }}>
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
                {/* --- MODIFIED: Added vibration animation --- */}
                <style jsx>{`
                    .joining-screen {
                        background-color: #2b2b2b;
                        color: white;
                    }
                    .caller-info {
                        text-align: center;
                        padding: 0 1rem; /* Added padding */
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
                    .call-actions-container {
                        display: flex;
                        flex-direction: column;
                        gap: 1.5rem; /* Space between sliders */
                        width: 100%;
                        max-width: 350px; /* Wider for slider */
                        margin-top: 5rem;
                        padding: 0 1rem; /* Added padding */
                    }

                    /* --- NEW: Slider Button CSS --- */
                    .slider-container {
                        position: relative;
                        width: 100%;
                        height: 60px;
                        background-color: rgba(255, 255, 255, 0.15);
                        border-radius: 30px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        overflow: hidden;
                        user-select: none;
                        border: 1px solid rgba(255, 255, 255, 0.2);
                    }
                    .slider-text-overlay {
                        position: absolute;
                        left: 0;
                        right: 0;
                        top: 0;
                        bottom: 0;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        font-size: 1.1rem;
                        font-weight: 500;
                        color: white;
                        pointer-events: none; /* Allows click-through */
                        z-index: 1;
                        
                        /* Shine animation */
                        -webkit-mask-image: linear-gradient(-75deg, rgba(0,0,0,.6) 30%, #000 50%, rgba(0,0,0,.6) 70%);
                        -webkit-mask-size: 200%;
                        animation: slide-shine 2s infinite;
                    }
                    .slider-thumb {
                        position: absolute;
                        left: 0;
                        top: 0;
                        bottom: 0;
                        width: 60px; /* Square shape */
                        height: 100%;
                        border-radius: 30px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        font-size: 1.8rem;
                        color: white;
                        cursor: grab;
                        z-index: 2;
                        border: 2px solid transparent;
                        /* --- NEW: Vibrate Animation --- */
                        animation: vibrate 0.5s ease-in-out infinite;
                        animation-delay: 1.5s;
                    }
                    .slider-thumb:active {
                        cursor: grabbing;
                        animation: none; /* --- NEW: Stop animation on drag --- */
                    }
                    .slider-thumb.accept-color {
                        background-color: #28a745;
                        border-color: #58c775;
                    }
                    .slider-thumb.decline-color {
                        background-color: #dc3545;
                        border-color: #e76573;
                    }
                    /* --- End Slider CSS --- */

                    /* --- NEW: Vibrate Keyframes --- */
                    @keyframes vibrate {
                        0%, 100% { transform: translateX(0); }
                        20% { transform: translateX(-2px); }
                        40% { transform: translateX(2px); }
                        60% { transform: translateX(-2px); }
                        80% { transform: translateX(2px); }
                    }


                    @keyframes slide-shine {
                        0% { -webkit-mask-position: 150%; }
                        100% { -webkit-mask-position: -50%; }
                    }
                `}</style>
                <div className="d-flex flex-column justify-content-around align-items-center joining-screen" style={{ minHeight: '100dvh' }}>
                    
                    <div className="caller-info">
                        <h1 className="caller-name">{callerName}</h1>
                        <h3 className="caller-id">{callData?.description || 'Incoming Call...'}</h3>
                    </div>

                    {/* --- MODIFIED: Replaced buttons with sliders --- */}
                    <div className="call-actions-container">
                        <SlideToActionButton
                            onAction={handleAcceptCall}
                            text="Slide to Accept"
                            iconClass="bi-telephone-fill"
                            colorClass="accept-color"
                            actionType="accept"
                        />
                        <SlideToActionButton
                            onAction={handleDeclineCall}
                            text="Slide to Decline"
                            iconClass="bi-telephone-x-fill"
                            colorClass="decline-color"
                            actionType="decline"
                        />
                    </div>
                </div>
            </>
        );
    }


    // RENDER: Active Call UI
    return (
        <>
            {/* --- MODIFIED: Navbar is **REMOVED** from active call --- */}
            
            <div className="chat-page-container">
                {/* --- MODIFIED: Adjusted CSS for no-navbar --- */}
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
                        min-height: 100dvh; /* --- MODIFIED: Full height --- */
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

                    /* --- 3. VIDEO PANEL (MODIFIED) --- */
                    .video-panel-container {
                        position: relative;
                        width: 100%;
                        height: 100dvh; /* --- MODIFIED: Full height --- */
                        background-color: var(--dark-bg-primary); /* --- MODIFIED: Match page bg --- */
                        overflow: hidden;
                        cursor: pointer; 
                        padding: 1.5rem; /* --- NEW: Added padding for boundary --- */
                    }
                    .remote-video {
                        width: 100%;
                        height: 100%;
                        object-fit: cover;
                        border-radius: 12px; /* --- NEW: Rounded corners --- */
                        background-color: #000; /* --- NEW: Black background for video --- */
                    }
                    
                    /* --- Draggable Self-View (PiP) --- */
                    .local-video-pip { /* This is now the wrapper */
                        position: absolute;
                        bottom: 1rem;
                        right: 1rem;
                        width: 150px;
                        height: 150px;
                        border-radius: 50%;
                        border: 2px solid var(--border-color);
                        z-index: 10;
                        cursor: move;
                        transition: box-shadow 0.2s ease, opacity 0.3s ease;
                        background: #333; /* Background for placeholder */
                        overflow: hidden; /* --- NEW: To keep icon inside --- */
                    }
                    /* --- MODIFIED: Adjust PiP position for new padding --- */
                    .local-video-pip:not([style*="left"]) { 
                         bottom: 2.5rem; /* 1rem + 1.5rem padding */
                         right: 2.5rem; /* 1rem + 1.5rem padding */
                    }
                    .local-video-pip[style*="opacity: 0"] {
                         display: none;
                    }
                    .local-video-pip:active {
                        box-shadow: 0 0 15px 5px rgba(255, 255, 255, 0.3);
                        cursor: grabbing;
                    }

                    /* --- NEW: PiP Inner Video Element --- */
                    .local-video-element {
                        width: 100%;
                        height: 100%;
                        object-fit: cover;
                        border-radius: 50%;
                        transition: opacity 0.2s ease;
                        position: relative;
                        z-index: 2; /* On top of placeholder */
                    }

                    /* --- NEW: PiP Camera-Off Placeholder --- */
                    .local-video-placeholder {
                        position: absolute;
                        top: 0;
                        left: 0;
                        width: 100%;
                        height: 100%;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        color: #fff;
                        font-size: 3rem;
                        border-radius: 50%;
                        z-index: 1; /* Below the video element */
                    }


                    .call-controls {
                        position: absolute;
                        bottom: 2rem;
                        left: 50%;
                        transform: translateX(-50%);
                        background-color: rgba(0, 0, 0, 0.7);
                        border-radius: 50px;
                        padding: 0.75rem; 
                        display: flex;
                        gap: 0.75rem; 
                        z-index: 20;
                        transition: opacity 0.3s ease; 
                        flex-wrap: wrap;
                        justify-content: center;
                        max-width: 90%;
                        
                        /* --- FIX: Added position: relative --- */
                        position: absolute; 
                    }
                    .call-controls.hidden { 
                        opacity: 0;
                        pointer-events: none;
                    }
                    .call-controls .btn {
                        width: 48px; 
                        height: 48px; 
                        font-size: 1.2rem; 
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        margin: 0; 
                    }

                    /* --- NEW: Quality Menu CSS --- */
                    .quality-menu {
                        position: absolute;
                        bottom: calc(100% + 1rem); /* 1rem above the controls */
                        left: 50%;
                        transform: translateX(-50%);
                        background-color: rgba(30, 30, 47, 0.95); /* var(--dark-bg-secondary) with opacity */
                        border-radius: 12px;
                        padding: 0.5rem;
                        z-index: 21;
                        border: 1px solid var(--border-color);
                        backdrop-filter: blur(5px);
                        display: flex;
                        flex-direction: column;
                        gap: 0.25rem;
                        width: 150px;
                    }
                    .quality-menu-button {
                        background-color: transparent;
                        border: none;
                        color: var(--text-primary);
                        padding: 0.5rem 0.75rem;
                        border-radius: 8px;
                        text-align: left;
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        font-size: 0.9rem;
                    }
                    .quality-menu-button:hover {
                        background-color: var(--accent-blue);
                    }
                    .quality-menu-button.active {
                        background-color: var(--accent-blue);
                        font-weight: bold;
                    }
                    .quality-menu-button i {
                        font-size: 0.75rem;
                    }
                    /* --- End Quality Menu CSS --- */

                    
                    /* --- 4. MOBILE OVERLAY PANELS (MODIFIED) --- */
                    .mobile-panel {
                        position: fixed;
                        top: 0; /* --- MODIFIED: Start at top --- */
                        left: 0;
                        width: 100%;
                        height: 100dvh;
                        background-color: var(--dark-bg-primary);
                        z-index: 1050; /* --- MODIFIED: Above navbar (1030) --- */
                        display: flex;
                        flex-direction: column;
                        padding-top: 0; /* --- MODIFIED: Remove old padding --- */
                    }
                    .mobile-panel-header {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        padding: 1rem;
                        border-bottom: 1px solid var(--border-color);
                        background-color: var(--dark-bg-secondary);
                        flex-shrink: 0;
                        /* --- NEW: Add safe-area padding for notch/island --- */
                        padding-top: calc(1rem + env(safe-area-inset-top));
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
                        /* --- NEW: Add safe-area padding for home bar --- */
                        padding-bottom: calc(1rem + env(safe-area-inset-bottom));
                    }


                    /* --- 5. DESKTOP VIEW (PC) --- */
                    @media (min-width: 992px) { 
                        .chat-page-container {
                            padding: 0; 
                            min-height: 100dvh; /* --- MODIFIED --- */
                        }
                        .video-panel-container {
                            height: 100dvh; /* --- MODIFIED --- */
                        }
                        .desktop-sidebar {
                            height: 100dvh; /* --- MODIFIED --- */
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
                            flex-wrap: nowrap;
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

                <div className="row g-0 h-100">

                    {/* --- Video Column --- */}
                    <div className="col-12 col-lg-8 d-flex flex-column">
                        <div 
                            className="video-panel-container shadow-sm"
                            onClick={() => {
                                setAreControlsVisible(!areControlsVisible);
                                setIsQualityMenuOpen(false); // Close menu when clicking bg
                            }} 
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
                            
                            {/* --- MODIFIED: Self-View (PiP) Wrapper --- */}
                            <div
                                ref={pipWrapperRef}
                                className="local-video-pip" 
                                style={{ opacity: stream ? 1 : 0 }}
                                onMouseDown={handlePipMouseDown}
                                onClick={(e) => e.stopPropagation()}
                                onMouseUp={handlePipMouseUp}
                                onMouseLeave={handlePipMouseUp}
                            >
                                <video
                                    ref={localVideoRef}
                                    className="local-video-element"
                                    style={{ 
                                        transform: 'scaleX(-1)', // --- MODIFIED: Hardcoded mirror ---
                                        opacity: isVideoOn ? 1 : 0 // Hide video element
                                    }}
                                    autoPlay
                                    playsInline
                                    muted
                                />
                                {/* --- NEW: Camera-Off Placeholder --- */}
                                {!isVideoOn && (
                                    <div className="local-video-placeholder">
                                        <i className="bi bi-camera-video-off-fill"></i>
                                    </div>
                                )}
                            </div>
                            
                            
                            {/* --- Call Controls --- */}
                            <div className={`call-controls ${!areControlsVisible ? 'hidden' : ''}`}>
                                
                                {/* --- FIX: Quality Menu moved INSIDE call-controls --- */}
                                {isQualityMenuOpen && (
                                    <div className="quality-menu" onClick={(e) => e.stopPropagation()}>
                                        <button 
                                            className={`quality-menu-button ${videoQuality === 'high' ? 'active' : ''}`}
                                            onClick={() => handleChangeVideoQuality('high')}
                                        >
                                            <span>High (1080p)</span>
                                            {videoQuality === 'high' && <i className="bi bi-check"></i>}
                                        </button>
                                        <button 
                                            className={`quality-menu-button ${videoQuality === 'medium' ? 'active' : ''}`}
                                            onClick={() => handleChangeVideoQuality('medium')}
                                        >
                                            <span>Medium (720p)</span>
                                            {videoQuality === 'medium' && <i className="bi bi-check"></i>}
                                        </button>
                                        <button 
                                            className={`quality-menu-button ${videoQuality === 'low' ? 'active' : ''}`}
                                            onClick={() => handleChangeVideoQuality('low')}
                                        >
                                            <span>Low (360p)</span>
                                            {videoQuality === 'low' && <i className="bi bi-check"></i>}
                                        </button>
                                    </div>
                                )}
                                {/* --- END FIX --- */}


                                {/* --- REMOVED: CAMERA SWAP BUTTON --- */}

                                <button
                                    className={`btn rounded-circle ${isVideoOn ? 'btn-secondary' : 'btn-danger'}`} 
                                    onClick={(e) => { e.stopPropagation(); handleToggleVideo(); }} 
                                    title={isVideoOn ? "Turn off camera" : "Turn on camera"}
                                >
                                    <i className={`bi ${isVideoOn ? 'bi-camera-video-fill' : 'bi-camera-video-off-fill'}`}></i>
                                </button>
                                
                                <button
                                    className={`btn rounded-circle ${muteStatus[user._id] ? 'btn-danger' : 'btn-secondary'}`} 
                                    onClick={(e) => { e.stopPropagation(); handleToggleMute(user._id); }} 
                                    title={muteStatus[user._id] ? "Unmute" : "Mute"}
                                >
                                    <i className={`bi ${muteStatus[user._id] ? 'bi-mic-mute-fill' : 'bi-mic-fill'}`}></i>
                                </button>
                                
                                {/* --- NEW: Quality Settings Button --- */}
                                <button
                                    className={`btn rounded-circle ${isQualityMenuOpen ? 'btn-primary' : 'btn-secondary'}`}
                                    onClick={(e) => { e.stopPropagation(); setIsQualityMenuOpen(!isQualityMenuOpen); }} 
                                    title="Video Quality"
                                >
                                    <i className="bi bi-gear-fill"></i>
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

                    {/* --- Desktop-Only Sidebar --- */}
                    <div 
                        className="col-lg-4 d-none d-lg-flex flex-column desktop-sidebar" // <-- Added class
                        style={{
                            height: '100dvh', // --- MODIFIED: Full height ---
                            gap: '1.5rem', 
                            padding: '1.5rem',
                            overflowY: 'auto'
                        }}
                    >
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