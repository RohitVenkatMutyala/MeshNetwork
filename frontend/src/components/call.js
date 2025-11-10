import React, {
    useState,
    useEffect,
    useRef,
    useLayoutEffect,
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
import SharingComponent from './SharingComponent';
import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.css';
import Navbar from './navbar';
import emailjs from '@emailjs/browser';

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

// --- NEW: Filter Definitions ---
const VIDEO_FILTERS = [
    { name: 'None', value: 'none' },
    { name: 'Noir', value: 'grayscale(100%)' },
    { name: 'Sepia', value: 'sepia(100%)' },
    { name: 'Vivid', value: 'saturate(200%)' },
    { name: 'Contrast', value: 'contrast(150%)' },
    { name: 'Bright', value: 'brightness(130%)' },
    { name: 'Invert', value: 'invert(100%)' },
    { name: 'Vintage', value: 'sepia(60%) contrast(110%) brightness(90%)' },
    { name: 'Cool', value: 'contrast(110%) saturate(150%) hue-rotate(-15deg)' },
];


// --- NEW: RemoteVideo Component ---
// This component handles rendering the remote streams in the grid
const RemoteVideo = ({ peer, name, videoFit, videoFilter, onDoubleClick }) => {
    const videoRef = useRef(null);
    const [isMuted, setIsMuted] = useState(false);

    useEffect(() => {
        if (peer && peer.stream && videoRef.current) {
            videoRef.current.srcObject = peer.stream;

            // Check for audio tracks to determine mute state
            const audioTracks = peer.stream.getAudioTracks();
            if (audioTracks.length > 0) {
                setIsMuted(!audioTracks[0].enabled);

                // Listen for mute/unmute events on the track
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
        <div className="video-tile" onDoubleClick={onDoubleClick}>
            <video
                ref={videoRef}
                autoPlay
                playsInline
                className="remote-video-element"
                style={{ objectFit: videoFit, filter: videoFilter }}
            />
            <div className="video-label">
                {isMuted && <i className="bi bi-mic-mute-fill me-2 text-danger"></i>}
                {name || '...'}
            </div>
        </div>
    );
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

        const maxLeft = containerRect.width - sliderRect.width - 2; // -2 for borders
        newLeft = Math.max(0, Math.min(newLeft, maxLeft));

        setSliderLeft(newLeft);

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
            setIsDragging(false);
            setSliderLeft(0);
            if (sliderRef.current) {
                sliderRef.current.style.transition = 'left 0.3s ease-out';
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
    const { user, loading } = useAuth();
    const { callId } = useParams();
    const navigate = useNavigate();

    // --- State Variables ---
    const heartbeatIntervalRef = useRef(null);
    const [messages, setMessages] = useState([]);
    const [newMessage, setNewMessage] = useState('');

    // -- Call State --
    const [callState, setCallState] = useState('loading');
    const [callData, setCallData] = useState(null);
    const [callOwnerId, setCallOwnerId] = useState(null);

    // --- UI State ---
    const [isChatOpen, setIsChatOpen] = useState(false);
    const [isParticipantsOpen, setIsParticipantsOpen] = useState(false);
    const [isShareOpen, setIsShareOpen] = useState(false);
    const [areControlsVisible, setAreControlsVisible] = useState(true);
    const [isQualityMenuOpen, setIsQualityMenuOpen] = useState(false);
    const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
    const [inviteEmails, setInviteEmails] = useState('');
    const [isInviting, setIsInviting] = useState(false);
    const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [isScreenSharing, setIsScreenSharing] = useState(false);
    const [fullscreenPeer, setFullscreenPeer] = useState(null);
    const [isChatOverlayVisible, setIsChatOverlayVisible] = useState(true);


    // --- Voice/Video Chat State ---
    const [stream, setStream] = useState(null);
    const [muteStatus, setMuteStatus] = useState({});
    const [isVideoOn, setIsVideoOn] = useState(true);
    const peersRef = useRef({});
    const audioContainerRef = useRef(null);
    const localVideoRef = useRef(null);
    const chatMessagesEndRef = useRef(null);
    const videoPanelRef = useRef(null);
    const [videoQuality, setVideoQuality] = useState('high');
    const [videoFit, setVideoFit] = useState('cover');
    const [videoFilter, setVideoFilter] = useState('none');

    // --- NEW: Refs for Screen Sharing ---
    const screenStreamRef = useRef(null);
    const cameraTrackRef = useRef(null);
    const micTrackRef = useRef(null);


    // --- MODIFIED: Renamed states for clarity ---
    const [participants, setParticipants] = useState([]); // Users *in* the call
    const [waitingUsers, setWaitingUsers] = useState([]); // Users *waiting* to join
    const [remoteStreams, setRemoteStreams] = useState([]); // Remote streams

    // --- RE-ADDED: Draggable PiP State ---
    const [isPipDragging, setIsPipDragging] = useState(false);
    const pipOffsetRef = useRef({ x: 0, y: 0 });
    const pipWrapperRef = useRef(null);

    // --- FIX: Moved participantsRef and its useEffect to the top level ---
    const participantsRef = React.useRef(participants);
    useEffect(() => {
        participantsRef.current = participants;
    }, [participants]);

    // --- NEW: Stable Ref Callback for Fullscreen Video ---
    // This creates a stable function that only changes when fullscreenPeer changes.
    // This stops the video from re-attaching its stream on every chat keystroke.
    const fullscreenVideoRef = useCallback((node) => {
        if (node && fullscreenPeer && fullscreenPeer.stream) {
            node.srcObject = fullscreenPeer.stream;
        }
    }, [fullscreenPeer]); // Dependency on fullscreenPeer is correct
    // Auto-scroll chat
    useEffect(() => {
        chatMessagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    // Main useEffect to handle call data and user presence
    useEffect(() => {
        // --- NEW: Auth Check ---
        // --- MODIFIED: Auth Check ---
        if (loading) {
            // Auth is still being checked, show the loading screen
            setCallState('loading');
            return;
        }

        // If loading is finished AND user is still null, they are logged out
        if (!user) {
            toast.error("You must be logged in to join a call.");
            navigate('/login', { replace: true });
            return;
        }

        // If loading is finished AND we have a user, but no callId
        if (!callId) {
            setCallState('denied'); // No call ID to load
            return;
        }
            // --- End Auth Check ---
           

        const callDocRef = doc(db, 'calls', callId);

        const updatePresence = () => {
            // Only update presence if user is in `activeParticipants`
            // --- FIX: Check participants list before updating ---
            const amIActive = (participantsRef.current || []).find(p => p.id === user._id);
            if (amIActive) {
                updateDoc(callDocRef, {
                    [`activeParticipants.${user._id}.lastSeen`]: serverTimestamp()
                }).catch(console.error);
            }
        };
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

            // --- NEW: Separate lists for participants and waiting ---
            const participantsMap = data.activeParticipants || {};
            const currentParticipants = Object.entries(participantsMap)
                .map(([userId, userData]) => ({
                    id: userId,
                    name: userData.name,
                }));
            setParticipants(currentParticipants); // <--- THIS IS THE "SOURCE OF TRUTH"

            const waitingMap = data.waitingRoom || {};
            const currentWaiting = Object.entries(waitingMap)
                .map(([userId, userData]) => ({
                    id: userId,
                    name: userData.name,
                }));
            setWaitingUsers(currentWaiting);
            // --- End NEW ---

            setMuteStatus(data.muteStatus || {});

            // --- MODIFIED: Refresh/Join Logic ---
            if (callState === 'loading') {
                const alreadyJoined = sessionStorage.getItem(`call_joined_${callId}`) === 'true';
                const isUserInCall = !!participantsMap[user._id];

                if (alreadyJoined || isUserInCall) {
                    setCallState('active'); // Go straight to call
                } else if (isOwner) {
                    setCallState('joining'); // Owner sees join screen
                } else {
                    // New user, add to waiting room
                    setCallState('waiting');
                    updateDoc(callDocRef, {
                        [`waitingRoom.${user._id}`]: {
                            name: `${user.firstname} ${user.lastname}`
                        }
                    }).catch(err => toast.error("Could not join waiting room."));
                }
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
                // Remove user from all possible maps on exit
                updateDoc(doc(db, 'calls', callId), {
                    [`activeParticipants.${user._id}`]: deleteField(),
                    [`waitingRoom.${user._id}`]: deleteField()
                }).catch(console.error);
            }
            if (stream) { stream.getTracks().forEach(track => track.stop()); }
            Object.values(peersRef.current).forEach(p => p.destroy());
            peersRef.current = {};
            unsubscribeCall();
            unsubscribeMessages();
        };
    },[callId, user, navigate, loading]); // --- MODIFIED ---


    // --- NEW: Stable participant ID string ---
    const participantIDs = JSON.stringify(participants.map(p => p.id).sort());

    // --- MODIFIED: Back to stable MESH WebRTC Logic ---
    useEffect(() => {
        if (!stream || callState !== 'active' || !user) return;

        const signalingColRef = collection(db, 'calls', callId, 'signaling');

        // --- NEW: Helper to add stream to state ---
        const addStream = (userId, stream) => {
            setRemoteStreams(prev => {
                if (prev.find(s => s.id === userId)) return prev;
                return [...prev, { id: userId, stream, userId }];
            });
        };

        // --- NEW: Helper to remove stream from state ---
        const removeStream = (userId) => {
            setRemoteStreams(prev => prev.filter(s => s.id !== userId));
        };

        // --- NEW: createPeer function (Initiator) ---
        const createPeer = (recipientId, senderId, stream) => {
            console.log(`Creating peer for ${recipientId}`);
            const peer = new Peer({ initiator: true, trickle: false, stream });

            peer.on('signal', signal => {
                addDoc(signalingColRef, { recipientId, senderId, signal });
            });
            peer.on('stream', remoteStream => {
                console.log(`Received stream from ${recipientId}`);
                addStream(recipientId, remoteStream);
            });
            peer.on('close', () => {
                console.log(`Connection closed with ${recipientId}`);
                removeStream(recipientId);
                delete peersRef.current[recipientId];
            });
            peer.on('error', (err) => {
                console.error(`Peer error (to ${recipientId}):`, err);
                removeStream(recipientId);
                delete peersRef.current[recipientId];
            });

            peersRef.current[recipientId] = peer;
        };

        // --- NEW: addPeer function (Non-Initiator) ---
        const addPeer = (incoming, recipientId, stream) => {
            console.log(`Accepting peer from ${incoming.senderId}`);
            const peer = new Peer({ initiator: false, trickle: false, stream });

            peer.on('signal', signal => {
                addDoc(signalingColRef, { recipientId: incoming.senderId, senderId: recipientId, signal });
            });
            peer.on('stream', remoteStream => {
                console.log(`Received stream from ${incoming.senderId}`);
                addStream(incoming.senderId, remoteStream);
            });
            peer.on('close', () => {
                console.log(`Connection closed with ${incoming.senderId}`);
                removeStream(incoming.senderId);
                delete peersRef.current[incoming.senderId];
            });
            peer.on('error', (err) => {
                console.error(`Peer error (from ${incoming.senderId}):`, err);
                removeStream(incoming.senderId);
                delete peersRef.current[incoming.senderId];
            });

            peer.signal(incoming.signal); // Accept the incoming offer
            peersRef.current[incoming.senderId] = peer;
        };

        // --- MODIFIED: Mesh network logic ---
        // Connect to all other participants
        participants.forEach(p => {
            if (p.id !== user._id && !peersRef.current[p.id]) {
                createPeer(p.id, user._id, stream);
            }
        });

        // --- MODIFIED: Cleanup logic ---
        // Remove peers for users who are no longer in the participants list
        Object.keys(peersRef.current).forEach(peerId => {
            if (!participants.find(p => p.id === peerId)) {
                console.log(`Destroying peer for ${peerId}`);
                if (peersRef.current[peerId]) {
                    peersRef.current[peerId].destroy();
                }
                delete peersRef.current[peerId];
                removeStream(peerId);
            }
        });

        // --- MODIFIED: Signaling listener ---
        const unsubscribeSignaling = onSnapshot(query(signalingColRef), snapshot => {
            snapshot.docChanges().forEach(change => {
                const data = change.doc.data();
                if (change.type === "added" && data.recipientId === user._id) {
                    const existingPeer = peersRef.current[data.senderId];

                    // --- BUG FIX: Handle new offers from refreshing users ---
                    if (data.signal.type === 'offer') {
                        // This is a new offer, likely from a refresh.
                        // Destroy any old peer and create a new one.
                        if (existingPeer) {
                            console.log(`Destroying stale peer for ${data.senderId} to accept new offer.`);
                            existingPeer.destroy();
                        }

                        // Only add peer if they are in the official participants list
                        if (participants.find(p => p.id === data.senderId)) {
                            console.log(`Accepting new offer from ${data.senderId}`);
                            addPeer(data, user._id, stream);
                        }

                    } else if (existingPeer && data.signal.type === 'answer') {
                        // This is an "answer" from a peer we already initiated
                        console.log(`Got signal answer from ${data.senderId}`);
                        existingPeer.signal(data.signal);
                    } else if (existingPeer) {
                        // This is another signal (like ICE candidate) for an existing peer
                        existingPeer.signal(data.signal);
                    }
                    // --- END BUG FIX ---

                    deleteDoc(change.doc.ref); // Signal consumed, delete it
                }
            });
        });

        return () => {
            unsubscribeSignaling();
        };
        // --- MODIFIED: Use stable participantIDs ---
    }, [stream, callState, user, callId, participantIDs]);

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
    }, [stream, callState, isVideoOn]); // <-- ADDED isVideoOn to fix toggle bug


    // --- NEW useEffect to handle refresh ---
    // This runs when callState becomes 'active' but the stream is still null
    useEffect(() => {
        if (callState === 'active' && !stream) {
            const getMediaOnRefresh = async () => {
                try {
                    const userStream = await getQualityStream(videoQuality, true);
                    setStream(userStream);
                    setIsVideoOn(true);
                    // No need to setCallState('active'), it already is
                } catch (err) {
                    toast.error("Could not re-access camera/microphone.");
                    console.error(err);
                    setCallState('denied'); // Can't join
                }
            };
            getMediaOnRefresh();
        }
    }, [callState, stream, videoQuality]); // Added dependencies


    // --- NEW: Fullscreen Change Listener ---
    // This syncs React state with the browser's fullscreen state (e.g., if user presses Esc)
    useEffect(() => {
        const handleFullscreenChange = () => {
            setIsFullscreen(document.fullscreenElement != null);
        };

        document.addEventListener('fullscreenchange', handleFullscreenChange);

        return () => {
            document.removeEventListener('fullscreenchange', handleFullscreenChange);
        };
    }, []);

    // --- NEW: Keyboard Shortcuts Handler ---
    useEffect(() => {
        const handleKeyDown = (e) => {
            // Don't trigger shortcuts if user is typing
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || callState !== 'active') {
                return;
            }

            // Check for Shift key for hang up
            if (e.shiftKey && (e.key === 'Q' || e.key === 'q')) {
                e.preventDefault();
                handleHangUp();
                return;
            }

            // Don't trigger on other Shift/Ctrl/Alt presses
            if (e.shiftKey || e.ctrlKey || e.altKey) {
                return;
            }

            switch (e.key) {
                case 'V':
                case 'v':
                    e.preventDefault();
                    handleToggleVideo();
                    break;
                case 'M':
                case 'm':
                    e.preventDefault();
                    handleToggleMute(user?._id);
                    break;
                case 'F':
                case 'f':
                    e.preventDefault();
                    handleToggleFullscreen();
                    break;
                case 'S':
                case 's':
                    e.preventDefault();
                    handleToggleScreenShare();
                    break;
                case 'Escape':
                    if (fullscreenPeer) {
                        setFullscreenPeer(null);
                        return;
                    }
                    // Close all modals
                    setIsInviteModalOpen(false);
                    setIsFilterModalOpen(false);
                    setIsQualityMenuOpen(false);
                    setIsChatOpen(false);
                    setIsParticipantsOpen(false);
                    setIsShareOpen(false);
                    break;
                default:
                    break;
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [user, stream, isVideoOn, muteStatus, isFullscreen, callState, callOwnerId, participants, callId, navigate, isScreenSharing, fullscreenPeer]);


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

            // Add user to active participants
            await updateDoc(doc(db, 'calls', callId), {
                [`muteStatus.${user._id}`]: false,
                [`activeParticipants.${user._id}`]: {
                    name: `${user.firstname} ${user.lastname}`,
                    lastSeen: serverTimestamp()
                },
                [`waitingRoom.${user._id}`]: deleteField() // Remove from waiting room
            });

            setStream(userStream);
            setIsVideoOn(true); // Video is on by default
            setCallState('active');

            // --- NEW: Set session storage flag ---
            sessionStorage.setItem(`call_joined_${callId}`, 'true');

        } catch (err) {
            toast.error("Could not access camera/microphone.");
            console.error(err);
        }
    };

    // --- NEW: Owner allows a user ---
    const handleAllowUser = async (userId, name) => {
        try {
            await updateDoc(doc(db, 'calls', callId), {
                [`waitingRoom.${userId}`]: deleteField(),
                [`activeParticipants.${userId}`]: {
                    name: name,
                    lastSeen: serverTimestamp()
                },
                [`muteStatus.${userId}`]: false
            });
            toast.success(`Allowed ${name} to join.`);
        } catch (err) {
            toast.error(`Failed to allow ${name}.`);
            console.error(err);
        }
    };

    // --- MODIFIED: Routing Fix ---
    const handleDeclineCall = () => {
        sessionStorage.removeItem(`call_joined_${callId}`);
        // Replace the current history item ("/call/:callId") with "/new-call"
        navigate('/new-call', { replace: true });
    };

    // --- MODIFIED: Routing Fix ---
    const handleHangUp = () => {
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
        }
        if (screenStreamRef.current) {
            screenStreamRef.current.getTracks().forEach(track => track.stop());
        }
        setStream(null);
        Object.values(peersRef.current).forEach(peer => peer.destroy());
        peersRef.current = {};

        sessionStorage.removeItem(`call_joined_${callId}`);
        // Replace the current history item ("/call/:callId") with "/new-call"
        navigate('/new-call', { replace: true });
    };

    // --- NEW: Fullscreen Toggle Handler ---
    const handleToggleFullscreen = () => {
        if (!videoPanelRef.current) return;

        if (isFullscreen) {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            }
        } else {
            if (videoPanelRef.current.requestFullscreen) {
                videoPanelRef.current.requestFullscreen();
            }
        }
    };

    const handleToggleVideo = () => {
        if (!stream) return;
        const newVideoState = !isVideoOn;
        setIsVideoOn(newVideoState);
    };

    // --- NEW: Screen Sharing Handlers ---
    const handleStopScreenShare = () => {
        // --- NEW: Close focus view if it's showing the local share ---
        setFullscreenPeer(prev => {
            if (prev && prev.id === 'local_screen_share') {
                return null;
            }
            return prev;
        });

        if (!cameraTrackRef.current || !screenStreamRef.current) {
            // This can happen if the user clicks "stop" before the stream is ready
            setIsScreenSharing(false);
            return;
        }

        const screenVideoTrack = screenStreamRef.current.getVideoTracks()[0];
        const screenAudioTrack = screenStreamRef.current.getAudioTracks()[0];

        // Replace tracks on all peers
        for (const peerId in peersRef.current) {
            const peer = peersRef.current[peerId];
            if (peer) {
                peer.replaceTrack(screenVideoTrack, cameraTrackRef.current, stream);
                if (screenAudioTrack && micTrackRef.current) {
                    peer.replaceTrack(screenAudioTrack, micTrackRef.current, stream);
                }
            }
        }

        // Stop the screen share stream tracks
        screenStreamRef.current.getTracks().forEach(track => track.stop());

        // Clear refs and state
        screenStreamRef.current = null;
        cameraTrackRef.current = null;
        micTrackRef.current = null;
        setIsScreenSharing(false);
    };

    const handleToggleScreenShare = async () => {
        if (isScreenSharing) {
            handleStopScreenShare();
            return;
        }

        if (!stream) {
            toast.error("You must be in the call to share your screen.");
            return;
        }

        try {
            const screenStream = await navigator.mediaDevices.getDisplayMedia({
                video: true,
                audio: true // Request system audio
            });

            screenStreamRef.current = screenStream;
            const screenVideoTrack = screenStream.getVideoTracks()[0];
            const screenAudioTrack = screenStream.getAudioTracks()[0]; // Might be null

            // Store original tracks
            cameraTrackRef.current = stream.getVideoTracks()[0];
            micTrackRef.current = stream.getAudioTracks()[0];

            // Replace tracks on all peers
            for (const peerId in peersRef.current) {
                const peer = peersRef.current[peerId];
                if (peer) {
                    peer.replaceTrack(cameraTrackRef.current, screenVideoTrack, stream);
                    if (screenAudioTrack) {
                        peer.replaceTrack(micTrackRef.current, screenAudioTrack, stream);
                    }
                }
            }

            // Listen for the browser's "Stop sharing" button
            screenVideoTrack.onended = () => {
                handleStopScreenShare();
            };

            setIsScreenSharing(true);

        } catch (err) {
            console.error("Screen share error:", err);
            toast.error("Could not start screen share.");
            // Ensure state is reset if it fails
            if (screenStreamRef.current) {
                screenStreamRef.current.getTracks().forEach(track => track.stop());
                screenStreamRef.current = null;
            }
            setIsScreenSharing(false);
        }
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
            if (oldVideoTrack) {
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

    // --- MODIFIED: Mute logic updated ---
    const handleToggleMute = async (targetUserId) => {
        if (!targetUserId) return; // Guard against null user on init
        const isSelf = targetUserId === user._id;

        if (isSelf) {
            // Users can always mute themselves
            const currentMuteState = muteStatus[targetUserId] ?? false;
            const newMuteState = !currentMuteState;
            await updateDoc(doc(db, 'calls', callId), {
                [`muteStatus.${targetUserId}`]: newMuteState
            });
        } else {
            // Only the owner can mute/unmute others
            const isTrueOwner = user && user._id === callOwnerId;
            if (isTrueOwner) {
                const currentMuteState = muteStatus[targetUserId] ?? false;
                const newMuteState = !currentMuteState;
                await updateDoc(doc(db, 'calls', callId), {
                    [`muteStatus.${targetUserId}`]: newMuteState
                });
                const targetName = participants.find(u => u.id === targetUserId)?.name || 'Participant';
                toast.success(newMuteState ? `Muted ${targetName}` : `Unmuted ${targetName}`);
            } else {
                toast.error("Only the call owner can mute/unmute others.");
            }
        }
    };

    // --- NEW: Toggle video fit mode ---
    const handleToggleVideoFit = (e) => {
        e.stopPropagation();
        setVideoFit(prevFit => (prevFit === 'cover' ? 'contain' : 'cover'));
        setIsQualityMenuOpen(false);
    };

    // --- NEW: Send Invites Handler ---
    const handleSendInvites = async (e) => {
        e.preventDefault();
        if (!inviteEmails) {
            toast.warn("Please enter at least one email.");
            return;
        }
        setIsInviting(true);

        const emails = inviteEmails.split(',').map(email => email.trim()).filter(email => email);
        if (emails.length === 0) {
            toast.warn("No valid emails found.");
            setIsInviting(false);
            return;
        }

        const callLink = `${window.location.origin}/call/${callId}`;
        const emailjsPublicKey = 'Cd-NUUSJ5dW3GJMo0';
        const serviceID = 'service_y8qops6';
        const templateID = 'template_apzjekq';

        try {
            // 1. Update permissions in Firestore
            const callDocRef = doc(db, 'calls', callId);
            await updateDoc(callDocRef, {
                allowedEmails: arrayUnion(...emails)
            });

            // 2. Send email to each new user
            let successCount = 0;
            for (const email of emails) {
                const templateParams = {
                    from_name: `${user.firstname} ${user.lastname}`,
                    to_email: email,
                    session_description: callData?.description || "a video call",
                    session_link: callLink,
                };
                try {
                    await emailjs.send(serviceID, templateID, templateParams, emailjsPublicKey);
                    successCount++;
                } catch (err) {
                    console.error(`Failed to send invite to ${email}:`, err);
                }
            }

            toast.success(`Sent ${successCount} invite(s)!`);
            setIsInviteModalOpen(false);
            setInviteEmails('');

        } catch (error) {
            console.error("Error sending invites:", error);
            toast.error("Could not update call permissions.");
        } finally {
            setIsInviting(false);
        }
    };

    const formatTimestamp = (timestamp) => !timestamp ? '' : timestamp.toDate().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

    const handleSendMessage = async (e) => {
        e.preventDefault();
        if (!user || newMessage.trim() === '') return;
        await addDoc(collection(db, 'calls', callId, 'messages'), { text: newMessage, senderName: `${user.firstname} ${user.lastname}`, senderId: user._id, timestamp: serverTimestamp() });
        setNewMessage('');
    };

    // --- RE-ADDED: Helper to get clientX/Y from touch or mouse ---
    const getClient = (e) => ({
        x: e.touches ? e.touches[0].clientX : e.clientX,
        y: e.touches ? e.touches[0].clientY : e.clientY,
    });

    // --- RE-ADDED: PiP Drag Handlers for Touch + Mouse ---
    const handlePipDragStart = (e) => {
        if (!pipWrapperRef.current) return;
        // e.preventDefault(); // May prevent text selection but also scrolling on touch
        setIsPipDragging(true);
        const { x, y } = getClient(e); // Use helper
        pipOffsetRef.current = {
            x: x - pipWrapperRef.current.getBoundingClientRect().left,
            y: y - pipWrapperRef.current.getBoundingClientRect().top,
        };
        pipWrapperRef.current.style.cursor = 'grabbing';
    };

    const handlePipDragEnd = () => {
        setIsPipDragging(false);
        if (pipWrapperRef.current) {
            pipWrapperRef.current.style.cursor = 'move';
        }
    };

    const handlePipDragMove = (e) => {
        if (!isPipDragging || !pipWrapperRef.current || !pipWrapperRef.current.parentElement) return;

        const { x, y } = getClient(e); // Use helper
        const parentRect = pipWrapperRef.current.parentElement.getBoundingClientRect();
        let newX = x - parentRect.left - pipOffsetRef.current.x;
        let newY = y - parentRect.top - pipOffsetRef.current.y;

        // Constrain to parent
        newX = Math.max(0, Math.min(newX, parentRect.width - pipWrapperRef.current.offsetWidth));
        newY = Math.max(0, Math.min(newY, parentRect.height - pipWrapperRef.current.offsetHeight));

        pipWrapperRef.current.style.left = `${newX}px`;
        pipWrapperRef.current.style.top = `${newY}px`;
        pipWrapperRef.current.style.bottom = 'auto';
        pipWrapperRef.current.style.right = 'auto';
    };
    // --- END PiP Handler Modifications ---


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

    // --- NEW: Waiting Room Screen ---
    if (callState === 'waiting') {
        return (
            <div className="d-flex justify-content-center align-items-center" style={{ height: '100dvh', backgroundColor: '#12121c' }}>
                <div className="text-center">
                    <div className="spinner-border text-primary mb-3" style={{ width: '3rem', height: '3rem' }} role="status">
                        <span className="visually-hidden">Loading...</span>
                    </div>
                    <h4 className="text-white">Waiting for the host to let you in...</h4>
                    <p className="text-secondary">Call: {callData?.description || callId}</p>
                </div>
            </div>
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
                <div className="d-flex flex-column justify-content-around align-items-center joining-screen" style={{ minHeight: 'calc(100dvh - 56px)' }}>

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
                        padding: 0.5rem; /* --- MODIFIED: Responsive padding --- */
                    }
                    
                    /* --- NEW: Video Grid Layout --- */
                    .video-grid-container {
                        display: grid;
                        gap: 0.5rem;
                        width: 100%;
                        height: 100%;
                        /* Dynamic grid based on participant count */
                    }
                    /* Classes to be added dynamically */
                    .grid-0 { grid-template-columns: 1fr; } /* Added for 0 remote streams */
                    .grid-1 { grid-template-columns: 1fr; }
                    .grid-2 { grid-template-columns: 1fr 1fr; }
                    .grid-3, .grid-4 { grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; }
                    .grid-5, .grid-6 { grid-template-columns: 1fr 1fr 1fr; grid-template-rows: 1fr 1fr; }
                    .grid-7, .grid-8, .grid-9 { grid-template-columns: 1fr 1fr 1fr; grid-template-rows: 1fr 1fr 1fr; }
                    
                    .video-tile {
                        position: relative;
                        background: #000;
                        border-radius: 12px;
                        overflow: hidden;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        cursor: pointer; /* --- NEW: Indicate clickable --- */
                    }
                    .remote-video-element, .local-video-element {
                        width: 100%;
                        height: 100%;
                        transition: object-fit 0.3s ease;
                    }
                    .local-video-element {
                        transform: scaleX(-1); /* Mirror self-view */
                        object-fit: cover; /* PiP is always cover */
                    }
                    .remote-video-element {
                         object-fit: ${videoFit}; /* Use state for zoom/fit */
                    }
                    .video-label {
                        position: absolute;
                        bottom: 0.5rem;
                        left: 0.5rem;
                        background: rgba(0,0,0,0.5);
                        color: white;
                        padding: 0.25rem 0.75rem;
                        border-radius: 6px;
                        font-size: 0.9rem;
                        font-weight: 500;
                        z-index: 5;
                    }
                    
                    /* --- RE-ADDED: Draggable Self-View (PiP) --- */
                    .local-video-pip { /* This is now the wrapper */
                        position: absolute;
                        bottom: 1rem;
                        right: 1rem;
                        width: 130px;
                        height: 130px;
                        border-radius: 12px; 
                        border: 2px solid var(--border-color);
                        z-index: 10;
                        cursor: move;
                        transition: box-shadow 0.2s ease, opacity 0.3s ease;
                        background: #333; /* Background for placeholder */
                        overflow: hidden; /* --- NEW: To keep icon inside --- */
                    }
                    /* --- MODIFIED: Adjust PiP position for new padding --- */
                    .local-video-pip:not([style*="left"]) { 
                        bottom: 1.5rem; /* 1rem + 0.5rem padding */
                        right: 1.5rem; /* 1rem + 0.5rem padding */
                    }
                    .local-video-pip[style*="opacity: 0"] {
                         display: none;
                    }
                    .local-video-pip:active {
                        box-shadow: 0 0 15px 5px rgba(255, 255, 255, 0.3);
                        cursor: grabbing;
                    }

                    /* --- RE-ADDED: PiP Camera-Off Placeholder --- */
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
                        border-radius: 12px;
                        z-index: 1; /* Below the video element */
                    }


                    .call-controls {
                        position: absolute;
                        bottom: 2rem;
                        left: 50%;
                        transform: translateX(-50%);
                        background-color: rgba(0, 0, 0, 0.7);
                        border-radius: 50px;
                        padding: 0.5rem; /* --- MODIFIED: Smaller padding --- */
                        display: flex;
                        gap: 0.5rem; /* --- MODIFIED: Smaller gap --- */
                        z-index: 20;
                        transition: opacity 0.3s ease; 
                        flex-wrap: wrap;
                        justify-content: center;
                        max-width: 95%; /* --- MODIFIED: Allow more width --- */
                        
                        position: absolute; 
                    }
                    .call-controls.hidden { 
                        opacity: 0;
                        pointer-events: none;
                    }
                    .call-controls .btn {
                        width: 44px; /* --- MODIFIED: Smaller buttons --- */
                        height: 44px; 
                        font-size: 1.1rem; /* --- MODIFIED: Smaller icon --- */
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

                    /* --- NEW: Filter Panel CSS --- */
                    .filter-panel {
                        position: absolute;
                        bottom: calc(100% + 1rem);
                        left: 50%;
                        transform: translateX(-50%);
                        background-color: rgba(30, 30, 47, 0.95);
                        border-radius: 12px;
                        padding: 0.75rem;
                        z-index: 21;
                        border: 1px solid var(--border-color);
                        backdrop-filter: blur(5px);
                        display: grid;
                        grid-template-columns: repeat(3, 1fr);
                        gap: 0.5rem;
                        width: 240px;
                    }
                    .filter-thumbnail {
                        width: 100%;
                        padding-top: 100%; /* 1:1 Aspect Ratio */
                        position: relative;
                        border-radius: 8px;
                        overflow: hidden;
                        cursor: pointer;
                        border: 2px solid transparent;
                        transition: border-color 0.2s ease;
                    }
                    .filter-thumbnail.active {
                        border-color: var(--accent-blue);
                    }
                    .filter-thumbnail video {
                        position: absolute;
                        top: 0;
                        left: 0;
                        width: 100%;
                        height: 100%;
                        object-fit: cover;
                        transform: scaleX(-1);
                    }
                    .filter-thumbnail span {
                        position: absolute;
                        bottom: 0;
                        left: 0;
                        right: 0;
                        text-align: center;
                        font-size: 0.75rem;
                        color: white;
                        background: rgba(0,0,0,0.5);
                        padding: 2px 0;
                    }

                    
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

                    /* --- NEW: Participant Card Styles --- */
                    .participant-card-list {
                        list-style-type: none;
                        padding: 0;
                        margin: 0;
                    }
                    .participant-card {
                        background-color: var(--dark-bg-secondary);
                        border: 1px solid var(--border-color);
                        border-radius: 12px;
                        /* --- MODIFIED: Tighter list --- */
                        margin-bottom: 0.5rem;
                        padding: 0.75rem 1rem; 
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                    }
                    .participant-card:last-child {
                        margin-bottom: 0;
                    }

                    /* --- NEW: Fullscreen Modal Styles --- */
                    .fullscreen-video-modal {
                        position: fixed;
                        top: 0;
                        left: 0;
                        right: 0;
                        bottom: 0;
                        background: #000;
                        z-index: 1060;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                    }
                    .fullscreen-video-modal video {
                        width: 100%;
                        height: 100%;
                        object-fit: contain;
                    }
                    .fullscreen-close-btn {
                        position: absolute;
                        top: 1.5rem;
                        right: 1.5rem;
                        z-index: 1063; 
                        font-size: 1.5rem;
                        color: white;
                        background: rgba(0, 0, 0, 0.4);
                        border: none;
                        border-radius: 50%;
                        width: 44px;
                        height: 44px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        line-height: 1;
                        cursor: pointer;
                    }
                    /* --- Re-use video-label for fullscreen modal --- */
                    .fullscreen-video-modal .video-label {
                        z-index: 1061;
                    }
                    
                    /* --- NEW: Fullscreen Chat Toggle Button --- */
                    .fullscreen-chat-toggle-btn {
                        position: absolute;
                        top: 1.5rem;
                        right: 5rem; /* Next to the close button */
                        z-index: 1063;
                        font-size: 1.2rem; /* a bit smaller */
                        color: white;
                        background: rgba(0, 0, 0, 0.4);
                        border: none;
                        border-radius: 50%;
                        width: 44px;
                        height: 44px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        line-height: 1;
                        cursor: pointer;
                    }

                    /* --- NEW: Fullscreen Chat Overlay --- */
                    .fullscreen-chat-overlay {
                        position: absolute;
                        top: 0;
                        right: 0;
                        bottom: 0;
                        width: 350px;
                        max-width: 90%; /* For mobile */
                        background: rgba(18, 18, 28, 0.85); /* Use var(--dark-bg-primary) with opacity */
                        backdrop-filter: blur(5px);
                        z-index: 1062;
                        display: flex;
                        flex-direction: column;
                        transform: ${isChatOverlayVisible ? 'translateX(0)' : 'translateX(100%)'};
                        transition: transform 0.3s ease;
                        border-left: 1px solid var(--border-color);
                    }
                    .fullscreen-chat-header {
                        padding: 1rem;
                        padding-top: calc(1.5rem + env(safe-area-inset-top));
                        font-weight: 600;
                        border-bottom: 1px solid var(--border-color);
                        flex-shrink: 0;
                        color: var(--text-primary);
                    }
                    .fullscreen-chat-messages {
                        flex-grow: 1;
                        overflow-y: auto;
                        padding: 1rem;
                    }
                    /* Re-use scrollbar styles */
                    .fullscreen-chat-messages::-webkit-scrollbar { width: 8px; }
                    .fullscreen-chat-messages::-webkit-scrollbar-track { background: var(--dark-bg-secondary); }
                    .fullscreen-chat-messages::-webkit-scrollbar-thumb { background-color: #555; border-radius: 4px; border: 2px solid var(--dark-bg-secondary); }

                    .fullscreen-chat-form {
                        padding: 1rem;
                        padding-bottom: calc(1rem + env(safe-area-inset-bottom));
                        border-top: 1px solid var(--border-color);
                        background: rgba(18, 18, 28, 0.5);
                        flex-shrink: 0;
                    }


                    /* --- 5. DESKTOP VIEW (PC) --- */
                    @media (min-width: 768px) {
                        .video-panel-container {
                            padding: 1.5rem; /* --- NEW: Larger padding on desktop --- */
                        }
                        .local-video-pip:not([style*="left"]) { 
                            bottom: 2.5rem; /* 1rem + 1.5rem padding */
                            right: 2.5rem; /* 1rem + 1.5rem padding */
                        }
                    }

                    /* --- MODIFIED: Changed 992px to 1200px (lg to xl) --- */
                    @media (min-width: 1200px) { 
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
                        .fullscreen-close-btn {
                            font-size: 2rem;
                            width: 50px;
                            height: 50px;
                        }
                        .fullscreen-chat-toggle-btn {
                            width: 50px;
                            height: 50px;
                            right: 6rem;
                        }
                    }

                    /* --- 6. CHAT STYLES (Used by both) --- */
                    
                    .desktop-sidebar {
                        height: 100dvh; /* --- NEW: Height for stacked mobile/laptop --- */
                        overflow-y: auto;
                        padding: 1.5rem;
                        gap: 1.5rem;
                        background-color: var(--dark-bg-primary);
                        /* --- NEW: Add border on left for desktop --- */
                        border-left: 1px solid var(--border-color);
                    }
                    
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
                        display: flex; align-items: center;
                        justify-content: center;
                        margin-left: 0.5rem; transition: background-color 0.2s ease;
                    }
                `}</style>

                <div className="row g-0 h-100">

                    {/* --- Video Column --- */}
                    {/* --- MODIFIED: Responsive column --- */}
                    <div className="col-12 col-xl-8 d-flex flex-column">
                        <div
                            ref={videoPanelRef}
                            className="video-panel-container shadow-sm"
                            onClick={() => {
                                setAreControlsVisible(!areControlsVisible);
                                setIsQualityMenuOpen(false); // Close menu when clicking bg
                                setIsFilterModalOpen(false); // --- NEW: Close filter panel ---
                            }}
                            // --- MODIFIED: Added touch move handler ---
                            onMouseMove={handlePipDragMove}
                            onTouchMove={handlePipDragMove}
                            // ---
                            onMouseUp={handlePipDragEnd}
                            onMouseLeave={handlePipDragEnd}
                            onTouchEnd={handlePipDragEnd}
                        >
                            {/* --- MODIFIED: Video Grid (Remote Only) --- */}
                            <div className={`video-grid-container grid-${remoteStreams.length}`}>
                                {/* Remote Video Tiles */}
                                {remoteStreams.map(data => (
                                    <RemoteVideo
                                        key={data.id}
                                        peer={data}
                                        name={participants.find(u => u.id === data.id)?.name}
                                        videoFit={videoFit}
                                        videoFilter={videoFilter}
                                        onDoubleClick={() => setFullscreenPeer(data)}
                                    />
                                ))}
                            </div>


                            {/* --- RE-ADDED: Self-View (PiP) Wrapper --- */}
                            <div
                                ref={pipWrapperRef}
                                className="local-video-pip"
                                style={{ opacity: stream ? 1 : 0 }}
                                onClick={(e) => e.stopPropagation()}
                                // --- MODIFIED: Added all drag handlers ---
                                onMouseDown={handlePipDragStart}
                                onTouchStart={handlePipDragStart}
                                onMouseUp={handlePipDragEnd}
                                onMouseLeave={handlePipDragEnd}
                                onTouchEnd={handlePipDragEnd}
                                onTouchMove={handlePipDragMove}
                            >
                                <video
                                    ref={localVideoRef}
                                    className="local-video-element"
                                    style={{
                                        transform: 'scaleX(-1)', // --- MODIFIED: Hardcoded mirror ---
                                        opacity: isVideoOn ? 1 : 0, // Hide video element
                                        filter: 'none' // --- MODIFIED: Local video has no filter ---
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

                                {/* --- NEW: Filter Panel --- */}
                                {isFilterModalOpen && (
                                    <div className="filter-panel" onClick={(e) => e.stopPropagation()}>
                                        {VIDEO_FILTERS.map(filter => (
                                            <div
                                                key={filter.name}
                                                className={`filter-thumbnail ${videoFilter === filter.value ? 'active' : ''}`}
                                                onClick={() => {
                                                    setVideoFilter(filter.value);
                                                    setIsFilterModalOpen(false);
                                                }}
                                            >
                                                {stream && (
                                                    <video
                                                        srcObject={stream}
                                                        style={{ filter: filter.value }}
                                                        autoPlay
                                                        muted
                                                        playsInline
                                                    />
                                                )}
                                                <span>{filter.name}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                {/* --- END Filter Panel --- */}


                                {/* --- REMOVED: CAMERA SWAP BUTTON --- */}

                                <button
                                    className={`btn rounded-circle ${isVideoOn ? 'btn-secondary' : 'btn-danger'}`}
                                    onClick={(e) => { e.stopPropagation(); handleToggleVideo(); }}
                                    title={isVideoOn ? "Turn off camera (V)" : "Turn on camera (V)"}
                                >
                                    <i className={`bi ${isVideoOn ? 'bi-camera-video-fill' : 'bi-camera-video-off-fill'}`}></i>
                                </button>

                                <button
                                    className={`btn rounded-circle ${muteStatus[user?._id] ? 'btn-danger' : 'btn-secondary'}`}
                                    onClick={(e) => { e.stopPropagation(); handleToggleMute(user?._id); }}
                                    title={muteStatus[user?._id] ? "Unmute (M)" : "Mute (M)"}
                                >
                                    <i className={`bi ${muteStatus[user?._id] ? 'bi-mic-mute-fill' : 'bi-mic-fill'}`}></i>
                                </button>

                                <button
                                    className={`btn rounded-circle ${isScreenSharing ? 'btn-success' : 'btn-secondary'}`}
                                    onClick={(e) => { e.stopPropagation(); handleToggleScreenShare(); }}
                                    title={isScreenSharing ? "Stop sharing (S)" : "Share screen (S)"}
                                >
                                    <i className={`bi ${isScreenSharing ? 'bi-stop-circle-fill' : 'bi-display-fill'}`}></i>
                                </button>

                                {/* --- NEW: View Own Screen Share Button --- */}
                                {isScreenSharing && (
                                    <button
                                        className="btn rounded-circle btn-primary"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setFullscreenPeer({
                                                id: 'local_screen_share',
                                                stream: screenStreamRef.current,
                                                userId: user._id
                                            });
                                        }}
                                        title="View your shared screen"
                                    >
                                        <i className="bi bi-person-video3"></i>
                                    </button>
                                )}

                                {/* --- NEW: Quality Settings Button --- */}
                                <button
                                    className={`btn rounded-circle ${isQualityMenuOpen ? 'btn-primary' : 'btn-secondary'}`}
                                    onClick={(e) => { e.stopPropagation(); setIsQualityMenuOpen(!isQualityMenuOpen); setIsFilterModalOpen(false); }}
                                    title="Video Quality"
                                >
                                    <i className="bi bi-gear-fill"></i>
                                </button>

                                {/* --- MODIFIED: Video Fit Toggle Button --- */}
                                <button
                                    className={`btn rounded-circle ${videoFit === 'contain' ? 'btn-primary' : 'btn-secondary'}`}
                                    onClick={handleToggleVideoFit}
                                    title={videoFit === 'cover' ? "Fit video to screen" : "Fill screen with video"}
                                >
                                    <i className={`bi ${videoFit === 'contain' ? 'bi-arrows-angle-contract' : 'bi-arrows-angle-expand'}`}></i>
                                </button>

                                {/* --- NEW: Fullscreen Button --- */}
                                <button
                                    className={`btn rounded-circle ${isFullscreen ? 'btn-primary' : 'btn-secondary'}`}
                                    onClick={(e) => { e.stopPropagation(); handleToggleFullscreen(); }}
                                    title={isFullscreen ? "Exit fullscreen (F)" : "Enter fullscreen (F)"}
                                >
                                    <i className={`bi ${isFullscreen ? 'bi-fullscreen-exit' : 'bi-fullscreen'}`}></i>
                                </button>

                                {/* --- NEW: Filter Button --- */}
                                <button
                                    className={`btn rounded-circle ${isFilterModalOpen ? 'btn-primary' : 'btn-secondary'}`}
                                    onClick={(e) => { e.stopPropagation(); setIsFilterModalOpen(!isFilterModalOpen); setIsQualityMenuOpen(false); }}
                                    title="Video Filters"
                                >
                                    <i className="bi bi-magic"></i>
                                </button>

                                {/* --- NEW: Add People Button --- */}
                                <button
                                    className="btn btn-primary rounded-circle"
                                    onClick={(e) => { e.stopPropagation(); setIsInviteModalOpen(true); }}
                                    title="Add People"
                                >
                                    <i className="bi bi-person-plus-fill"></i>
                                </button>

                                {/* Chat (MOBILE ONLY) */}
                                <button
                                    className="btn btn-primary rounded-circle d-xl-none" // --- MODIFIED: d-xl-none ---
                                    onClick={(e) => { e.stopPropagation(); setIsChatOpen(true); }}
                                    title="Show Chat"
                                >
                                    <i className="bi bi-chat-dots-fill"></i>
                                </button>

                                {/* Participants (MOBILE ONLY) */}
                                <button
                                    className="btn btn-primary rounded-circle d-xl-none" // --- MODIFIED: d-xl-none ---
                                    onClick={(e) => { e.stopPropagation(); setIsParticipantsOpen(true); }}
                                    title="Show Participants"
                                >
                                    <i className="bi bi-people-fill"></i>
                                </button>

                                {/* Share (MOBILE ONLY) */}
                                <button
                                    className="btn btn-primary rounded-circle d-xl-none" // --- MODIFIED: d-xl-none ---
                                    onClick={(e) => { e.stopPropagation(); setIsShareOpen(true); }}
                                    title="Share Link"
                                >
                                    <i className="bi bi-share-fill"></i>
                                </button>

                                {/* Hangup Button */}
                                <button
                                    className="btn btn-danger rounded-circle"
                                    onClick={(e) => { e.stopPropagation(); handleHangUp(); }}
                                    title="Hang Up (Shift+Q)"
                                >
                                    <i className="bi bi-telephone-fill" style={{ transform: 'rotate(135deg)' }}></i>
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* --- Desktop-Only Sidebar --- */}
                    <div
                        className="col-12 col-xl-4 d-xl-flex flex-column desktop-sidebar" // --- MODIFIED: col-xl-4, d-xl-flex ---
                    >
                        {/* --- NEW: Waiting Room Card --- */}
                        {user?._id === callOwnerId && waitingUsers.length > 0 && (
                            <div className="card shadow-sm border-warning">
                                <div className="card-header d-flex justify-content-between text-warning">
                                    <span>Waiting Room ({waitingUsers.length})</span>
                                    <i className="bi bi-person-exclamation"></i>
                                </div>
                                <ul className="list-group list-group-flush p-3 participant-card-list" style={{ maxHeight: '150px', overflowY: 'auto' }}>
                                    {waitingUsers.map(p => (
                                        <li key={p.id} className="participant-card">
                                            <div>
                                                <span className="fw-bold">{p.name}</span>
                                            </div>
                                            <button
                                                className="btn btn-sm btn-success"
                                                onClick={() => handleAllowUser(p.id, p.name)}
                                            >
                                                Allow
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {/* Participants Card (Desktop) */}
                        <div className="card shadow-sm">
                            <div className="card-header d-flex justify-content-between">
                                <span>Participants ({participants.length})</span>
                                <i className="bi bi-broadcast text-success"></i>
                            </div>
                            {/* --- MODIFIED: Participant Card List --- */}
                            <ul className="list-group list-group-flush p-3 participant-card-list" style={{ maxHeight: '150px', overflowY: 'auto' }}>
                                {participants.map(p => (
                                    <li key={p.id} className="participant-card">
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
                        {/* <div><SharingComponent sessionId={callId} /></div> */}

                        {/* Chat Card (Desktop) */}
                        <div className="card shadow-sm flex-grow-1 chat-card">
                            <div className="card-header d-flex align-items-center">
                                <span
                                    className="spinner-grow spinner-grow-sm text-success me-2"
                                    role="status"
                                    aria-hidden="true"
                                    style={{ width: '0.8rem', height: '0.8rem' }}
                                ></span>
                                Chat
                            </div>
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
                    <div className="mobile-panel d-xl-none">
                        <div className="mobile-panel-header">
                            <h5>Participants ({participants.length})</h5>
                            <button className="btn-close btn-close-white" onClick={() => setIsParticipantsOpen(false)}></button>
                        </div>
                        <div className="mobile-panel-body">
                            {/* --- NEW: Waiting Room (Mobile) --- */}
                            {user?._id === callOwnerId && waitingUsers.length > 0 && (
                                <div className="mb-4">
                                    <h6 className="text-warning">Waiting Room ({waitingUsers.length})</h6>
                                    <ul className="participant-card-list">
                                        {waitingUsers.map(p => (
                                            <li key={p.id} className="participant-card">
                                                <div>
                                                    <span className="fw-bold">{p.name}</span>
                                                </div>
                                                <button
                                                    className="btn btn-sm btn-success"
                                                    onClick={() => handleAllowUser(p.id, p.name)}
                                                >
                                                    Allow
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            {/* --- MODIFIED: Participant Card List --- */}
                            <h6 className="text-light">In The Call</h6>
                            <ul className="participant-card-list">
                                {participants.map(p => (
                                    <li key={p.id} className="participant-card">
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
                    <div className="mobile-panel d-xl-none">
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
                    <div className="mobile-panel mobile-chat-panel d-xl-none">
                        <div className="mobile-panel-header">
                            {/* --- MODIFIED: Added div and spinner --- */}
                            <div className="d-flex align-items-center">
                                <span
                                    className="spinner-grow spinner-grow-sm text-success me-2"
                                    role="status"
                                    aria-hidden="true"
                                    style={{ width: '0.8rem', height: '0.8rem' }}
                                ></span>
                                <h5> Chat</h5>
                            </div>

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

                {/* --- NEW: Invite People Modal --- */}

                {isInviteModalOpen && (
                    <div className="mobile-panel">
                        <div className="mobile-panel-header">
                            <h5>Invite People</h5>
                            <button className="btn-close btn-close-white" onClick={() => setIsInviteModalOpen(false)}></button>
                        </div>

                        {/* --- MODIFIED: Panel body with new layout --- */}
                        <div className="mobile-panel-body" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>



                            {/* --- MODIFIED: Email Form (for dark theme) --- */}
                            <form onSubmit={handleSendInvites} style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, gap: '1rem' }}>
                                <p className="text-secondary" style={{ margin: 0 }}>
                                    Invite with email. Add multiple separated by commas.
                                </p>
                                <div className="form-floating" style={{ flexGrow: 1 }}>
                                    <textarea
                                        className="form-control"
                                        id="inviteEmails"

                                        style={{
                                            height: '100%',
                                            minHeight: '120px',
                                            backgroundColor: 'var(--dark-bg-primary)',
                                            color: 'var(--text-primary)',
                                            borderColor: 'var(--border-color)'
                                        }}
                                        value={inviteEmails}
                                        onChange={(e) => setInviteEmails(e.target.value)} // Fixed typo from e.gex
                                    />
                                    <label htmlFor="inviteEmails" style={{ color: 'var(--text-secondary)' }}>Emails (comma-separated)</label>
                                </div>
                                <button
                                    type="submit"
                                    className="btn btn-primary w-100"
                                    disabled={isInviting}
                                    style={{
                                        backgroundColor: 'var(--accent-blue)',
                                        borderColor: 'var(--accent-blue)',
                                        fontWeight: '600',
                                        padding: '0.75rem',
                                        borderRadius: '12px' // Matches participant card radius
                                    }}
                                >
                                    {isInviting ? (
                                        <>
                                            <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                                            Sending Invites...
                                        </>
                                    ) : (
                                        'Send Invites'
                                    )}
                                </button>
                            </form>
                        </div>
                    </div>
                )}

                {/* --- MODIFIED: Fullscreen Video Modal with Chat Overlay --- */}
                {/* --- MODIFIED: Fullscreen Video Modal with Chat Overlay --- */}
                {fullscreenPeer && (
                    <div className="fullscreen-video-modal" onClick={(e) => {
                        // Only close if clicking the modal backdrop, not the chat
                        if (e.target === e.currentTarget) {
                            setFullscreenPeer(null);
                        }
                    }}>
                        <button className="fullscreen-close-btn" onClick={() => setFullscreenPeer(null)}>
                            <i className="bi bi-x-lg"></i>
                        </button>

                        <button
                            className="fullscreen-chat-toggle-btn"
                            onClick={(e) => {
                                e.stopPropagation(); // Don't close modal
                                setIsChatOverlayVisible(!isChatOverlayVisible);
                            }}
                        >
                            <i className={isChatOverlayVisible ? "bi bi-chat-dots-fill" : "bi bi-chat-dots"}></i>
                        </button>

                        <video
                            // --- THIS IS THE FIX ---
                            // Use the new stable ref callback
                            ref={fullscreenVideoRef}
                            // --- END FIX ---
                            autoPlay
                            playsInline
                            style={{ filter: videoFilter }}
                        />
                        <div className="video-label">
                            {/* --- MODIFIED: Handle local screen share name --- */}
                            {fullscreenPeer.id === 'local_screen_share'
                                ? (user ? `${user.firstname} ${user.lastname} (Your Screen)` : 'Your Screen')
                                : (participants.find(u => u.id === fullscreenPeer.id)?.name || '...')}
                        </div>

                        {/* --- NEW: Chat Overlay --- */}
                        <div
                            className="fullscreen-chat-overlay"
                            onClick={(e) => e.stopPropagation()} // Prevent modal from closing
                        >
                            <div className="fullscreen-chat-header">
                                Chat
                            </div>
                            <div className="fullscreen-chat-messages">
                                {/* Re-use chat message logic */}
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
                            <form onSubmit={handleSendMessage} className="fullscreen-chat-form">
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