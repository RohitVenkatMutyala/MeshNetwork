import React, { useState, useEffect, useCallback } from 'react'; // Added useCallback
import { useNavigate } from 'react-router-dom';
import { db } from '../firebaseConfig'; // Kept original import
import {
    collection, query, where, orderBy, limit, onSnapshot,
    doc, setDoc, serverTimestamp, runTransaction, deleteDoc,
    updateDoc, addDoc, getDoc, writeBatch, getDocs
} from 'firebase/firestore'; // Added writeBatch, getDocs, limit
import { useAuth } from '../context/AuthContext'; // Kept original import
import { toast } from 'react-toastify';
import emailjs from '@emailjs/browser'; // Kept original import

// --- NEW: Audio Context for Notification Sound ---
// We create this outside the component to be persistent
let audioContext = null;

// This function initializes the audio context, required by browsers
// It must be called by a user gesture (a click)
const initAudioContext = () => {
    if (audioContext) return;
    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        // Resume the context if it's in a suspended state
        if (audioContext.state === 'suspended') {
            audioContext.resume();
        }
        console.log("Audio Context Initialized by user gesture.");
    } catch (e) {
        console.error("Web Audio API is not supported in this browser.", e);
    }
};

// This function plays a generated sound
const playNotificationSound = () => {
    if (!audioContext) {
        console.warn("Audio Context not initialized. User must click first.");
        return;
    }

    try {
        // Create an OscillatorNode to generate a tone
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        oscillator.type = 'sine'; // A simple beep
        oscillator.frequency.setValueAtTime(900, audioContext.currentTime); // High-pitched
        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime); // Not too loud

        // Fade out quickly
        gainNode.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.5);

        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.5); // Play for 0.5s
    } catch (e) {
        console.error("Error playing notification sound:", e);
    }
};

// Helper function to get today's date
const getTodayString = () => {
    return new Date().toISOString().split('T')[0];
};

// --- Custom component for the call notification toast ---
// --- Custom component for the call notification toast ---
// ADDED: callType prop
const CallNotification = ({ callerName, callId, callType, onClose, navigate }) => {

    const handleJoin = () => {
        // --- FIX: Determine route based on callType ---
        const targetRoute = callType === 'audio' ? `/audio-call/${callId}` : `/call/${callId}`;
        navigate(targetRoute);
        onClose();
    };

    return (
        <div className="call-notification-toast">
            <strong className="d-block mb-2">{callerName} is calling!</strong>
            <p className="mb-3">
                {/* Visual indicator of call type */}
                {callType === 'audio' ? <i className="bi bi-mic-fill me-1"></i> : <i className="bi bi-camera-video-fill me-1"></i>}
                Incoming {callType === 'audio' ? 'Audio' : 'Video'} Call
            </p>
            <div className="d-flex justify-content-end gap-2">
                <button className="btn btn-sm btn-light" onClick={onClose}>
                    Dismiss
                </button>
                <button className="btn btn-sm btn-success" onClick={handleJoin}>
                    Join
                </button>
            </div>
        </div>
    );
};


function RecentCalls({ searchTerm }) {
    const { user } = useAuth();
    const [allCalls, setAllCalls] = useState([]);
    const [filteredCalls, setFilteredCalls] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isCalling, setIsCalling] = useState(null);
    const [isDeleting, setIsDeleting] = useState(null);
    const [dailyCallCount, setDailyCallCount] = useState(0);
    const dailyCallLimit = 32;
    const navigate = useNavigate();

    const [deleteTarget, setDeleteTarget] = useState(null);

    // Profile visibility state
    const [isOnline, setIsOnline] = useState(true);
    const [isVisibilityLoading, setIsVisibilityLoading] = useState(true);
    const [showVisibilityModal, setShowVisibilityModal] = useState(false);

    // Notification Bell State
    const [allNotifications, setAllNotifications] = useState([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [showNotificationModal, setShowNotificationModal] = useState(false);
    const [isNotifModalLoading, setIsNotifModalLoading] = useState(false);


    // --- NEW: Effect to initialize Audio Context on first click ---
    useEffect(() => {
        // This is required for browsers that block audio until a user interaction
        window.addEventListener('click', initAudioContext, { once: true });

        return () => {
            // Clean up listener just in case
            window.removeEventListener('click', initAudioContext);
        };
    }, []); // Empty dependency array, runs only once on mount


    // --- Helper function to show the call toast ---
    // Wrapped in useCallback to safely use in useEffect dependency array
    // --- Helper function to show the call toast ---
    const showCallToast = useCallback((notification) => {
        playNotificationSound();

        const dismissToast = (id) => toast.dismiss(id);

        const toastId = toast(
            <CallNotification
                callerName={notification.callerName}
                callId={notification.callId}
                // --- FIX: Pass the callType from DB ---
                callType={notification.callType || 'video'}
                onClose={() => dismissToast(toastId)}
                navigate={navigate}
            />,
            {
                autoClose: false,
                closeOnClick: false,
                draggable: false,
                closeButton: false,
                position: "top-right",
                pauseOnHover: true,
            }
        );
    }, [navigate]);

    // Function to send email
    const sendInvitationEmails = async (callId, callDescription, invitedEmail) => {
        // ... (This function is unchanged)
        if (!invitedEmail) return;
        const emailjsPublicKey = 'Cd-NUUSJ5dW3GJMo0';
        const serviceID = 'service_y8qops6';
        const templateID = 'template_apzjekq';
        const callLink = `${window.location.origin}/call/${callId}`;
        const templateParams = {
            from_name: `${user.firstname} ${user.lastname}`,
            to_email: invitedEmail,
            session_description: callDescription,
            session_link: callLink,
        };
        try {
            await emailjs.send(serviceID, templateID, templateParams, emailjsPublicKey);
        } catch (error) {
            console.error(`Failed to send invitation to ${invitedEmail}:`, error);
            toast.error(`Could not send invite to ${invitedEmail}.`);
        }
    };

    // "Speed dial" function
    // --- UPDATE THIS FUNCTION IN RecentCalls.js ---
    // --- UPDATED: handleReCall ---
    const handleReCall = async (callId, recipientName, recipientEmail, description, destinationRoute = '/call/') => {
        if (!user) {
            toast.error("You must be logged in to make a call.");
            return;
        }
        setIsCalling(callId);

        // --- FIX: Determine Call Type based on route ---
        const callType = destinationRoute.includes('audio') ? 'audio' : 'video';

        const today = getTodayString();
        const limitDocRef = doc(db, 'userCallLimits', user._id);
        const newCallId = Math.random().toString(36).substring(2, 9);
        const callDocRef = doc(db, 'calls', newCallId);

        try {
            await runTransaction(db, async (transaction) => {
                const limitDoc = await transaction.get(limitDocRef);
                let currentCount = 0;

                if (limitDoc.exists()) {
                    const data = limitDoc.data();
                    if (data.lastCallDate === today) {
                        currentCount = data.count;
                    }
                }
                if (currentCount >= dailyCallLimit) {
                    throw new Error(`You have reached your daily limit of ${dailyCallLimit} calls.`);
                }
                const newCount = currentCount + 1;

                transaction.set(callDocRef, {
                    description,
                    createdAt: serverTimestamp(),
                    ownerId: user._id,
                    ownerName: `${user.firstname} ${user.lastname}`,
                    ownerEmail: user.email,
                    recipientName: recipientName,
                    recipientEmail: recipientEmail,
                    access: 'private',
                    defaultRole: 'editor',
                    allowedEmails: [user.email, recipientEmail],
                    permissions: { [user._id]: 'editor' },
                    muteStatus: { [user._id]: false },
                    // --- OPTIONAL: Save type in call doc too ---
                    type: callType
                });

                transaction.set(limitDocRef, {
                    count: newCount,
                    lastCallDate: today
                });
            });

            // Send in-app notification
            try {
                await addDoc(collection(db, 'notifications'), {
                    recipientEmail: recipientEmail,
                    callerName: `${user.firstname} ${user.lastname}`,
                    callerEmail: user.email,
                    callId: newCallId,
                    createdAt: serverTimestamp(),
                    status: 'pending',
                    type: 'call',
                    // --- FIX: Save the callType here ---
                    callType: callType
                });
            } catch (err) {
                console.warn("Failed to send in-app notification:", err);
            }

            // Send Invitation Email
            await sendInvitationEmails(newCallId, description, recipientEmail);

            toast.success(`Calling ${recipientName}...`);
            navigate(`${destinationRoute}${newCallId}`);

        } catch (error) {
            console.error("Failed to create call:", error);
            toast.error(error.message || "Could not create the call.");
            setIsCalling(null);
        }
    };

    // --- All other functions (delete, visibility, etc.) are unchanged ---

    const promptForDelete = (callId, displayName) => {
        setDeleteTarget({ id: callId, name: displayName });
    };

    const confirmDelete = async () => {
        if (!deleteTarget) return;
        const { id, name } = deleteTarget;
        setIsDeleting(id);
        const callDocRef = doc(db, 'calls', id);
        try {
            await deleteDoc(callDocRef);
            toast.success(`'${name}' deleted.`);
        } catch (error) {
            console.error("Error deleting call:", error);
            toast.error("Could not delete the contact.");
        } finally {
            setIsDeleting(null);
            setDeleteTarget(null);
        }
    };

    const handleVisibilityToggle = async () => {
        if (!user || !db) return;
        const newIsOnline = !isOnline;
        setIsOnline(newIsOnline);
        const userSettingsRef = doc(db, 'users', user._id);
        try {
            const userDoc = await getDoc(userSettingsRef);
            const hasSeenPrompt = userDoc.exists() ? userDoc.data().hasSeenVisibilityPrompt : false;
            if (newIsOnline && !hasSeenPrompt) {
                setShowVisibilityModal(true);
            }
            await setDoc(userSettingsRef, {
                isOnline: newIsOnline
            }, { merge: true });
        } catch (error) {
            console.error("Error updating visibility:", error);
            toast.error("Could not update visibility status.");
            setIsOnline(!newIsOnline);
        }
    };

    const handleCloseVisibilityModal = async () => {
        setShowVisibilityModal(false);
        if (!user || !db) return;
        try {
            const userSettingsRef = doc(db, 'users', user._id);
            await setDoc(userSettingsRef, {
                hasSeenVisibilityPrompt: true
            }, { merge: true });
        } catch (error) {
            console.error("Error marking visibility prompt as seen:", error);
        }
    };

    const openNotificationModal = async () => {
        setShowNotificationModal(true);
        setIsNotifModalLoading(true);

        const q = query(
            collection(db, 'notifications'),
            where('recipientEmail', '==', user.email),
            orderBy('createdAt', 'desc'),
            limit(50)
        );
        const querySnapshot = await getDocs(q);
        const notifs = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        setAllNotifications(notifs);
        setIsNotifModalLoading(false);

        const unreadNotifs = notifs.filter(n => n.status === 'unread');
        if (unreadNotifs.length > 0) {
            const batch = writeBatch(db);
            unreadNotifs.forEach(notif => {
                const docRef = doc(db, 'notifications', notif.id);
                batch.update(docRef, { status: 'read' });
            });
            await batch.commit();
        }
    };
    const handleOpenChat = (otherName, otherEmail) => {
        if (!user || !otherEmail) return;

        // Sort emails to ensure both users generate the same ID
        const participants = [user.email, otherEmail].sort();
        const conversationId = participants.join('_');
        const collectionName = 'direct_chats';

        // Navigate to the new page, passing the name in 'state' so we can display it
        navigate(`/chat/${collectionName}/${conversationId}`, {
            state: { recipientName: otherName }
        });
    };
    // --- All original Effects (1-4) are unchanged ---

    // Effect 1: Fetch all calls
    useEffect(() => {
        if (!user) {
            setLoading(false);
            return;
        }
        const callsQuery = query(
            collection(db, 'calls'),
            where('allowedEmails', 'array-contains', user.email),
            orderBy('createdAt', 'desc'),
            limit(20)
        );
        const unsubscribe = onSnapshot(callsQuery, (snapshot) => {
            const callsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            const uniqueCalls = [];
            const seenEmails = new Set();
            for (const call of callsData) {
                const isOwner = call.ownerId === user._id;
                const otherPersonEmail = isOwner ? call.recipientEmail : call.ownerEmail;
                if (otherPersonEmail && !seenEmails.has(otherPersonEmail)) {
                    seenEmails.add(otherPersonEmail);
                    uniqueCalls.push(call);
                }
            }
            setAllCalls(uniqueCalls);
            setFilteredCalls(uniqueCalls);
            setLoading(false);
        }, (error) => {
            console.error("Error fetching recent calls:", error);
            setLoading(false);
        });
        return () => unsubscribe();
    }, [user]);

    // Effect 2: Fetch daily call count
    useEffect(() => {
        if (!user) {
            setDailyCallCount(0);
            return;
        }
        const today = getTodayString();
        const limitDocRef = doc(db, 'userCallLimits', user._id);
        const unsubscribe = onSnapshot(limitDocRef, (doc) => {
            if (doc.exists()) {
                const data = doc.data();
                if (data.lastCallDate === today) {
                    setDailyCallCount(data.count);
                } else {
                    setDailyCallCount(0);
                }
            } else {
                setDailyCallCount(0);
            }
        });
        return () => unsubscribe();
    }, [user]);

    // Effect 3: Filter calls on search
    useEffect(() => {
        if (!user) return;
        if (!searchTerm) {
            setFilteredCalls(allCalls);
            return;
        }
        const lowerCaseSearch = searchTerm.toLowerCase();
        const filtered = allCalls.filter(call => {
            const isOwner = call.ownerId === user._id;
            const displayName = isOwner ? call.recipientName : call.ownerName;
            const displayEmail = isOwner ? call.recipientEmail : call.ownerEmail;
            return (
                displayName?.toLowerCase().includes(lowerCaseSearch) ||
                displayEmail?.toLowerCase().includes(lowerCaseSearch) ||
                call.id.toLowerCase().includes(lowerCaseSearch)
            );
        });
        setFilteredCalls(filtered);
    }, [searchTerm, allCalls, user]);

    // Effect 4: Listen for visibility status
    useEffect(() => {
        if (!user) {
            setIsVisibilityLoading(false);
            return;
        }
        setIsVisibilityLoading(true);
        const userSettingsRef = doc(db, 'users', user._id);
        const unsubscribe = onSnapshot(userSettingsRef, (doc) => {
            if (doc.exists()) {
                const data = doc.data();
                setIsOnline(data.isOnline ?? true);
            } else {
                setIsOnline(true);
            }
            setIsVisibilityLoading(false);
        }, (error) => {
            console.error("Error fetching visibility status:", error);
            setIsVisibilityLoading(false);
            setIsOnline(true);
        });
        return () => unsubscribe();
    }, [user]);

    // --- MODIFIED Effect 5: Listen for PENDING (toast) notifications ---
    useEffect(() => {
        if (!user) return;

        const notificationsQuery = query(
            collection(db, 'notifications'),
            where('recipientEmail', '==', user.email),
            where('status', '==', 'pending')
        );

        const unsubscribe = onSnapshot(notificationsQuery, async (snapshot) => {
            if (snapshot.empty) return;

            const batch = writeBatch(db);
            snapshot.docs.forEach((docSnap) => {
                const notification = docSnap.data();

                if (notification.type === 'call') {
                    // This now calls the useCallback version
                    showCallToast(notification);
                }

                // Update status to 'unread' to stop toast and add to bell
                batch.update(docSnap.ref, { status: 'unread' });
            });

            await batch.commit();
        });

        return () => unsubscribe();
    }, [user, showCallToast]); // Use showCallToast in dependency array


    // --- Effect 6: Listen for UNREAD (bell) notifications ---
    useEffect(() => {
        if (!user) return;
        const q = query(
            collection(db, 'notifications'),
            where('recipientEmail', '==', user.email),
            where('status', '==', 'unread')
        );
        const unsubscribe = onSnapshot(q, (snapshot) => {
            setUnreadCount(snapshot.size);
        });
        return () => unsubscribe();
    }, [user]);


    // --- Helper functions for formatting (unchanged) ---
    const formatTimestamp = (timestamp) => {
        if (!timestamp) return 'No date';
        if (timestamp && typeof timestamp.toDate === 'function') {
            return timestamp.toDate().toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric'
            });
        }
        return new Date(timestamp).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });
    };

    const formatTimeAgo = (timestamp) => {
        if (!timestamp) return '...';
        const date = timestamp.toDate();
        const seconds = Math.floor((new Date() - date) / 1000);
        let interval = seconds / 31536000;
        if (interval > 1) return Math.floor(interval) + "y ago";
        interval = seconds / 2592000;
        if (interval > 1) return Math.floor(interval) + "m ago";
        interval = seconds / 86400;
        if (interval > 1) return Math.floor(interval) + "d ago";
        interval = seconds / 3600;
        if (interval > 1) return Math.floor(interval) + "h ago";
        interval = seconds / 60;
        if (interval > 1) return Math.floor(interval) + "min ago";
        return "Just now";
    };

    const getAvatarColor = (name) => {
        const colors = ['#fd7e14', '#6f42c1', '#d63384', '#198754', '#0d6efd', '#dc3545', '#ffc107'];
        if (!name) return colors[0];
        const charCodeSum = name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
        return colors[charCodeSum % colors.length];
    };

    // --- Loading State ---
    if (loading) {
        return (
            <div className="d-flex justify-content-center align-items-center py-5">
                <div className="spinner-border text-primary" role="status">
                    <span className="visually-hidden">Loading...</span>
                </div>
            </div>
        );
    }

    // --- Render JSX ---
    return (
        <>
            {/* Global & Component Styles */}
            <style jsx global>{`
                :root {
                    --wa-bg: #111b21;
                    --wa-header: #202c33;
                    --wa-hover: #2a3942;
                    --wa-primary: #e9edef;
                    --wa-secondary: #8696a0;
                    --wa-accent: #00a884;
                    --wa-danger: #ef5350;
                    --wa-blue: #53bdeb;
                }

                /* Scrollbar Customization */
                ::-webkit-scrollbar { width: 6px; }
                ::-webkit-scrollbar-track { background: transparent; }
                ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 3px; }
            `}</style>

            <style jsx>{`
                .recent-calls-container {
                    background-color: var(--wa-bg);
                    height: 100%;
                    display: flex;
                    flex-direction: column;
                    border-right: 1px solid rgba(255,255,255,0.1);
                    color: var(--wa-primary);
                    position: relative;
                    overflow: hidden;
                }

                /* --- STICKY HEADER SECTION (Fixes overlapping) --- */
                .sticky-header {
                    position: sticky;
                    top: 0;
                    z-index: 100;
                    background-color: var(--wa-bg);
                    padding-bottom: 5px;
                    border-bottom: 1px solid rgba(134, 150, 160, 0.15);
                }

                /* Search Bar */
                .search-wrapper {
                    padding: 10px 15px;
                }
                .search-input-group {
                    background-color: var(--wa-header);
                    border-radius: 8px;
                    display: flex;
                    align-items: center;
                    padding: 0 15px;
                    height: 35px;
                }
                .search-icon { color: var(--wa-secondary); font-size: 0.85rem; }
                .search-input {
                    background: transparent;
                    border: none;
                    color: var(--wa-primary);
                    width: 100%;
                    margin-left: 15px;
                    font-size: 0.9rem;
                    outline: none;
                }
                .search-input::placeholder { color: var(--wa-secondary); }

                /* Call Stats & Bell Row */
                .stats-row {
                    display: flex; justify-content: space-between; align-items: center;
                    padding: 8px 20px;
                    font-size: 0.85rem;
                    color: var(--wa-secondary);
                }
                .bell-btn {
                    position: relative; cursor: pointer; color: var(--wa-secondary); transition: 0.2s;
                }
                .bell-btn:hover { color: var(--wa-primary); }
                .badge-dot {
                    position: absolute; top: -2px; right: -2px;
                    width: 8px; height: 8px;
                    background-color: var(--wa-accent);
                    border-radius: 50%;
                }

                /* --- LIST AREA --- */
                .recent-calls-list {
                    flex: 1;
                    overflow-y: auto;
                    padding-top: 5px;
                }

                /* Call Item Card */
                .call-item {
                    display: flex; align-items: center;
                    padding: 12px 15px;
                    cursor: pointer;
                    transition: background-color 0.2s;
                    border-bottom: 1px solid rgba(134, 150, 160, 0.1);
                }
                .call-item:hover { background-color: var(--wa-hover); }

                .avatar-container {
                    position: relative; margin-right: 15px;
                }
                .call-avatar {
                    width: 45px; height: 45px; border-radius: 50%;
                    display: flex; align-items: center; justify-content: center;
                    font-weight: 500; color: white; font-size: 1.1rem;
                    flex-shrink: 0;
                }

                .call-info {
                    flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center;
                }
                .info-top {
                    display: flex; justify-content: space-between; align-items: baseline;
                    margin-bottom: 3px;
                }
                .call-name {
                    font-size: 1rem; color: var(--wa-primary);
                    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
                }
                .call-date {
                    font-size: 0.75rem; color: var(--wa-secondary);
                    flex-shrink: 0; margin-left: 10px;
                }

                .info-bottom {
                    display: flex; justify-content: space-between; align-items: center;
                }
                .call-email {
                    font-size: 0.85rem; color: var(--wa-secondary);
                    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
                    max-width: 80%;
                }
                
                /* Actions (Show on Hover) */
                .call-actions {
                    display: flex; gap: 15px;
                    opacity: 0; transition: opacity 0.2s;
                }
                .call-item:hover .call-actions { opacity: 1; }
                
                .action-icon {
                    font-size: 1.1rem; color: var(--wa-secondary);
                    background: none; border: none; padding: 0;
                    cursor: pointer; transition: 0.2s;
                }
                .action-icon:hover { color: var(--wa-primary); }
                .icon-call:hover { color: var(--wa-accent); }
                .icon-delete:hover { color: var(--wa-danger); }

                /* Empty State */
                .empty-state {
                    padding: 40px; text-align: center; color: var(--wa-secondary);
                    font-size: 0.9rem;
                }

                /* Visibility Toggle */
                .visibility-control {
                    padding: 15px;
                    border-top: 1px solid rgba(134, 150, 160, 0.1);
                    background-color: var(--wa-header);
                    display: flex; justify-content: space-between; align-items: center;
                }
                .vis-label { font-size: 0.9rem; color: var(--wa-primary); }
                
                /* Switch */
                .switch { position: relative; display: inline-block; width: 34px; height: 20px; }
                .switch input { opacity: 0; width: 0; height: 0; }
                .slider {
                    position: absolute; cursor: pointer;
                    top: 0; left: 0; right: 0; bottom: 0;
                    background-color: #3b4a54; transition: .4s; border-radius: 34px;
                }
                .slider:before {
                    position: absolute; content: "";
                    height: 14px; width: 14px; left: 3px; bottom: 3px;
                    background-color: white; transition: .4s; border-radius: 50%;
                }
                input:checked + .slider { background-color: var(--wa-accent); }
                input:checked + .slider:before { transform: translateX(14px); }

                /* Modal Overlays (Reused logic, updated style) */
                .modal-overlay {
                    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
                    background: rgba(0,0,0,0.7); z-index: 1000;
                    display: flex; align-items: center; justify-content: center;
                }
                .modal-card {
                    background: var(--wa-header); color: var(--wa-primary);
                    width: 90%; max-width: 400px; padding: 20px;
                    border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.5);
                }
                .modal-btn {
                    padding: 8px 16px; border-radius: 4px; border: none; font-weight: 500; margin-left: 10px;
                }
                .btn-cancel { background: transparent; color: var(--wa-accent); border: 1px solid var(--wa-accent); }
                .btn-danger { background: var(--wa-danger); color: white; }
                .btn-primary { background: var(--wa-accent); color: white; }

                @media (max-width: 576px) {
                    .call-actions { opacity: 1; gap: 10px; } /* Always show actions on mobile */
                    .call-item { padding: 10px; }
                }
            `}</style>

            <div className="recent-calls-container">

                {/* --- STICKY HEADER --- */}
                <div className="sticky-header">
                    <div className="search-wrapper">
                        <div className="search-input-group">
                            <i className="bi bi-search search-icon"></i>
                            <input
                                type="text"
                                className="search-input"
                                placeholder="Search or start new call"
                                value={searchTerm || ''}
                            // Assuming you have a setSearchTerm handler in parent, 
                            // otherwise add onChange logic here if passed as prop
                            />
                        </div>
                    </div>

                    <div className="stats-row">
                        <span>Calls ({dailyCallCount}/{dailyCallLimit})</span>
                        <div className="bell-btn" onClick={openNotificationModal} title="Notifications">
                            <i className="bi bi-bell-fill"></i>
                            {unreadCount > 0 && <span className="badge-dot"></span>}
                        </div>
                    </div>
                </div>

                {/* --- SCROLLABLE LIST --- */}
                <div className="recent-calls-list">
                    {!user ? (
                        <div className="empty-state">Please log in to see recent calls.</div>
                    ) : filteredCalls.length === 0 ? (
                        <div className="empty-state">No chats or calls found.</div>
                    ) : (
                        filteredCalls.map(call => {
                            const isCurrentUserOwner = call.ownerId === user._id;
                            const displayName = isCurrentUserOwner ? call.recipientName : call.ownerName;
                            const displayEmail = isCurrentUserOwner ? call.recipientEmail : call.ownerEmail;

                            if (!displayName) return null;

                            return (
                                <div key={call.id} className="call-item" onClick={() => navigate(`/call/${call.id}`)}>
                                    <div className="avatar-container">
                                        <div
                                            className="call-avatar"
                                            style={{ backgroundColor: getAvatarColor(displayName) }}
                                        >
                                            {displayName.charAt(0).toUpperCase()}
                                        </div>
                                    </div>

                                    <div className="call-info">
                                        <div className="info-top">
                                            <span className="call-name">{displayName}</span>
                                            <span className="call-date">{formatTimestamp(call.createdAt)}</span>
                                        </div>
                                        <div className="info-bottom">
                                            <span className="call-email">
                                                {displayEmail}
                                            </span>

                                            {/* Action Icons (Hover to see) */}
                                            {/* --- UPDATE THIS SECTION IN RecentCalls.js --- */}
                                            <div className="call-actions" onClick={(e) => e.stopPropagation()}>

                                                {/* 1. Audio Call Button */}
                                                <button
                                                    className="action-icon icon-call"
                                                    title="Voice Call"
                                                    disabled={isCalling === call.id}
                                                    // Sends '/audio-call/' as destination
                                                    onClick={() => handleReCall(call.id, displayName, displayEmail, call.description, '/audio-call/')}
                                                >
                                                    {isCalling === call.id ? (
                                                        <span className="spinner-border spinner-border-sm text-success"></span>
                                                    ) : (
                                                        <i className="bi bi-telephone-fill"></i>
                                                    )}
                                                </button>

                                                {/* 2. Video Call Button */}
                                                <button
                                                    className="action-icon icon-call"
                                                    title="Video Call"
                                                    disabled={isCalling === call.id}
                                                    // Sends '/call/' as destination (Default Video)
                                                    onClick={() => handleReCall(call.id, displayName, displayEmail, call.description, '/call/')}
                                                >
                                                    <i className="bi bi-camera-video-fill"></i>
                                                </button>

                                                <button
                                                    className="action-icon"
                                                    title="Chat"
                                                    onClick={() => handleOpenChat(displayName, displayEmail)}
                                                >
                                                    <i className="bi bi-chat-left-text-fill"></i>
                                                </button>

                                                <button
                                                    className="action-icon icon-delete"
                                                    title="Delete"
                                                    onClick={() => promptForDelete(call.id, displayName)}
                                                >
                                                    <i className="bi bi-trash"></i>
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>

                {/* --- FOOTER VISIBILITY --- */}
                <div className="visibility-control">
                    <span className="vis-label">Profile Visibility (Online)</span>
                    <label className="switch">
                        <input
                            type="checkbox"
                            checked={isOnline}
                            onChange={handleVisibilityToggle}
                            disabled={isVisibilityLoading}
                        />
                        <span className="slider"></span>
                    </label>
                </div>

            </div>

            {/* --- MODALS (Simplified for new theme) --- */}
            {deleteTarget && (
                <div className="modal-overlay" onClick={() => setDeleteTarget(null)}>
                    <div className="modal-card" onClick={(e) => e.stopPropagation()}>
                        <h5>Delete Contact?</h5>
                        <p style={{ color: 'var(--wa-secondary)', fontSize: '0.9rem' }}>
                            Are you sure you want to delete <strong>{deleteTarget.name}</strong>?
                        </p>
                        <div className="d-flex justify-content-end mt-4">
                            <button className="modal-btn btn-cancel" onClick={() => setDeleteTarget(null)}>Cancel</button>
                            <button className="modal-btn btn-danger" onClick={confirmDelete}>Delete</button>
                        </div>
                    </div>
                </div>
            )}

            {showVisibilityModal && (
                <div className="modal-overlay" onClick={handleCloseVisibilityModal}>
                    <div className="modal-card" onClick={(e) => e.stopPropagation()}>
                        <h5>Profile Visibility</h5>
                        <p style={{ color: 'var(--wa-secondary)', fontSize: '0.9rem', lineHeight: '1.5' }}>
                            Enabling this allows others to see you in the "Online Users" list.
                        </p>
                        <div className="d-flex justify-content-end mt-4">
                            <button className="modal-btn btn-primary" onClick={handleCloseVisibilityModal}>Got it</button>
                        </div>
                    </div>
                </div>
            )}

            {showNotificationModal && (
                <div className="modal-overlay" onClick={() => setShowNotificationModal(false)}>
                    <div className="modal-card" onClick={(e) => e.stopPropagation()}>
                        <div className="d-flex justify-content-between align-items-center mb-3">
                            <h5>Notifications</h5>
                            <button className="action-icon" onClick={() => setShowNotificationModal(false)}><i className="bi bi-x-lg"></i></button>
                        </div>
                        <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                            {allNotifications.length === 0 ? (
                                <p className="text-center text-muted my-4">No notifications.</p>
                            ) : (
                                allNotifications.map(notif => (
                                    <div key={notif.id} className="p-2 border-bottom border-secondary" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
                                        <div className="d-flex justify-content-between">
                                            <strong style={{ fontSize: '0.9rem' }}>{notif.callerName}</strong>
                                            <small className="text-muted" style={{ fontSize: '0.7rem' }}>{formatTimeAgo(notif.createdAt)}</small>
                                        </div>
                                        <div className="d-flex justify-content-between align-items-center mt-1">
                                            <span style={{ fontSize: '0.85rem', color: 'var(--wa-secondary)' }}>{notif.type === 'call' ? 'Incoming Call' : 'New Alert'}</span>
                                            {notif.type === 'call' && (
                                                <button
                                                    className="action-icon icon-call"
                                                    // --- FIX: Check callType for navigation ---
                                                    onClick={() => {
                                                        const route = notif.callType === 'audio' ? '/audio-call/' : '/call/';
                                                        navigate(`${route}${notif.callId}`);
                                                        setShowNotificationModal(false);
                                                    }}
                                                >
                                                    {/* Change Icon based on type */}
                                                    {notif.callType === 'audio' ? (
                                                        <i className="bi bi-telephone-fill"></i>
                                                    ) : (
                                                        <i className="bi bi-camera-video-fill"></i>
                                                    )}
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

export default RecentCalls;