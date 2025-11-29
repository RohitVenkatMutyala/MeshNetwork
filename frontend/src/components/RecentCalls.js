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
const CallNotification = ({ callerName, callId, onClose, navigate }) => {

    const handleJoin = () => {
        navigate(`/call/${callId}`);
        onClose();
    };

    return (
        <div className="call-notification-toast">
            <strong className="d-block mb-2">{callerName} is calling!</strong>
            <p className="mb-3">Do you want to join the session?</p>
            <div className="d-flex justify-content-end gap-2">
                <button className="btn btn-sm btn-light" onClick={onClose}>
                    Dismiss
                </button>
                <button className="btn btn-sm btn-success" onClick={handleJoin}>
                    Join Call
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
    const showCallToast = useCallback((notification) => {
        // --- NEW: Play sound ---
        playNotificationSound();

        // Function to pass to the toast to dismiss it
        const dismissToast = (id) => toast.dismiss(id);

        // Show the toast and get its ID
        const toastId = toast(
            <CallNotification
                callerName={notification.callerName}
                callId={notification.callId}
                onClose={() => dismissToast(toastId)} // Pass dismiss function
                navigate={navigate} // Pass navigate function
            />,
            {
                autoClose: false,
                closeOnClick: false,
                draggable: false,
                closeButton: false, // Our component has close/decline
                position: "top-right",
                pauseOnHover: true,
            }
        );
    }, [navigate]); // Dependency on navigate


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
    const handleReCall = async (callId, recipientName, recipientEmail, description) => {
        // ... (This function is unchanged, still sends 'pending' notification)
        if (!user) {
            toast.error("You must be logged in to make a call.");
            return;
        }
        setIsCalling(callId);

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
                    status: 'pending', // 'pending' triggers the toast
                    type: 'call'
                });
            } catch (err) {
                console.warn("Failed to send in-app notification:", err);
            }

            await sendInvitationEmails(newCallId, description, recipientEmail);
            toast.success(`Calling ${recipientName}...`);
            navigate(`/call/${newCallId}`);

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
            {/* Global Styles for Theme & Scrollbar */}
            <style jsx global>{`
                :root {
                    /* Default Light Theme */
                    --wa-bg: #ffffff;
                    --wa-header: #f0f2f5;
                    --wa-border: #e9edef;
                    --wa-hover: #f5f6f6;
                    --wa-primary: #111b21;
                    --wa-secondary: #667781;
                    --wa-accent: #008069;
                    --wa-danger: #ea0038;
                    --wa-search-bg: #ffffff;
                    --wa-icon-color: #54656f;
                }

                /* Dark Theme Override */
                [data-theme='dark'] {
                    --wa-bg: #111b21;
                    --wa-header: #202c33;
                    --wa-border: rgba(134, 150, 160, 0.15);
                    --wa-hover: #2a3942;
                    --wa-primary: #e9edef;
                    --wa-secondary: #8696a0;
                    --wa-accent: #00a884;
                    --wa-search-bg: #202c33;
                    --wa-icon-color: #aebac1;
                }

                /* Scrollbar */
                ::-webkit-scrollbar { width: 6px; }
                ::-webkit-scrollbar-track { background: transparent; }
                ::-webkit-scrollbar-thumb { background: rgba(134, 150, 160, 0.3); border-radius: 3px; }
            `}</style>

            <style jsx>{`
                .recent-calls-container {
                    background-color: var(--wa-bg);
                    height: 100%;
                    display: flex;
                    flex-direction: column;
                    border-right: 1px solid var(--wa-border);
                    color: var(--wa-primary);
                    position: relative;
                    overflow: hidden;
                    transition: background-color 0.3s ease;
                }

                /* --- HEADER SECTION --- */
                .sticky-header {
                    position: sticky;
                    top: 0;
                    z-index: 100;
                    background-color: var(--wa-header);
                    padding: 10px 16px;
                    border-bottom: 1px solid var(--wa-border);
                }

                .header-top {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 10px;
                }
                .header-title {
                    font-size: 1.3rem;
                    font-weight: 700;
                    color: var(--wa-primary);
                }
                .header-actions {
                    display: flex;
                    gap: 15px;
                }
                .icon-btn {
                    background: transparent;
                    border: none;
                    color: var(--wa-icon-color);
                    font-size: 1.2rem;
                    cursor: pointer;
                    transition: color 0.2s;
                    position: relative;
                }
                .icon-btn:hover { color: var(--wa-primary); }
                
                .badge-dot {
                    position: absolute; top: -2px; right: -2px;
                    width: 8px; height: 8px;
                    background-color: var(--wa-accent);
                    border-radius: 50%;
                    border: 2px solid var(--wa-header);
                }

                /* Search Bar */
                .search-wrapper {
                    position: relative;
                }
                .search-input {
                    width: 100%;
                    background-color: var(--wa-search-bg);
                    border: none;
                    border-radius: 8px;
                    padding: 7px 15px 7px 40px; /* Left padding for icon */
                    color: var(--wa-primary);
                    font-size: 0.9rem;
                    outline: none;
                    transition: box-shadow 0.2s;
                }
                .search-input:focus {
                    box-shadow: 0 0 0 2px rgba(0, 168, 132, 0.3);
                }
                .search-input::placeholder { color: var(--wa-secondary); }
                .search-icon {
                    position: absolute;
                    left: 12px;
                    top: 50%;
                    transform: translateY(-50%);
                    color: var(--wa-secondary);
                    font-size: 0.85rem;
                }

                /* --- LIST AREA --- */
                .recent-calls-list {
                    flex: 1;
                    overflow-y: auto;
                }

                /* Contact Card */
                .call-item {
                    display: flex;
                    align-items: center;
                    padding: 12px 16px;
                    cursor: pointer;
                    transition: background-color 0.2s;
                    position: relative; /* For positioning context menu */
                }
                .call-item:hover { background-color: var(--wa-hover); }
                .call-item::after {
                    content: '';
                    position: absolute;
                    bottom: 0;
                    right: 0;
                    width: 82%; /* Indent separator */
                    height: 1px;
                    background-color: var(--wa-border);
                }

                .avatar-container { margin-right: 15px; }
                .call-avatar {
                    width: 49px;
                    height: 49px;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-weight: 500;
                    color: white;
                    font-size: 1.2rem;
                    flex-shrink: 0;
                }

                .call-info {
                    flex: 1;
                    min-width: 0;
                    display: flex;
                    flex-direction: column;
                    justify-content: center;
                }
                
                .info-top {
                    display: flex;
                    justify-content: space-between;
                    align-items: baseline;
                    margin-bottom: 2px;
                }
                .call-name {
                    font-size: 1rem;
                    color: var(--wa-primary);
                    font-weight: 400;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }
                .call-date {
                    font-size: 0.75rem;
                    color: var(--wa-secondary);
                    flex-shrink: 0;
                    margin-left: 10px;
                }

                .info-bottom {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                .call-desc {
                    font-size: 0.85rem;
                    color: var(--wa-secondary);
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    max-width: 90%;
                }
                
                /* Hover Actions (Call Buttons) */
                /* Initially hidden, show on hover */
                .call-hover-actions {
                    display: none;
                    gap: 15px;
                    align-items: center;
                }
                .call-item:hover .call-hover-actions { display: flex; }
                .call-item:hover .call-date { display: none; } /* Hide date on hover to show buttons */

                .action-icon {
                    font-size: 1.2rem;
                    color: var(--wa-secondary);
                    background: none;
                    border: none;
                    padding: 0;
                    cursor: pointer;
                    transition: color 0.2s;
                }
                .action-icon:hover { color: var(--wa-primary); }
                
                /* Empty State */
                .empty-state {
                    padding: 40px;
                    text-align: center;
                    color: var(--wa-secondary);
                    font-size: 0.95rem;
                    margin-top: 20px;
                }

                /* --- CONTEXT MENU (Right Click) --- */
                .context-menu {
                    position: absolute;
                    background-color: var(--wa-header);
                    border-radius: 6px;
                    box-shadow: 0 2px 10px rgba(0,0,0,0.3);
                    z-index: 1000;
                    min-width: 150px;
                    overflow: hidden;
                    animation: fadeIn 0.1s ease;
                }
                .context-menu-item {
                    padding: 10px 20px;
                    cursor: pointer;
                    color: var(--wa-primary);
                    font-size: 0.9rem;
                    transition: background 0.2s;
                }
                .context-menu-item:hover { background-color: var(--wa-hover); }
                .context-menu-item.delete { color: var(--wa-danger); }

                @keyframes fadeIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
            `}</style>

            {/* --- MAIN CONTAINER --- */
                /* Logic to handle theme class if passed as prop, or fallback to data-theme attribute on body */
            }
            <div className="recent-calls-container">

                {/* --- HEADER --- */}
                <div className="sticky-header">
                    <div className="header-top">
                        <div className="header-title">Chats</div>
                        <div className="header-actions">
                            <button className="icon-btn" title="Add New Contact" onClick={() => setStep(1)}>
                                <i className="bi bi-pencil-square"></i>
                            </button>
                            <button className="icon-btn" onClick={openNotificationModal} title="Notifications">
                                <i className="bi bi-bell"></i>
                                {unreadCount > 0 && <span className="badge-dot"></span>}
                            </button>
                            {/* Visibility Toggle Icon */}
                            <button
                                className="icon-btn"
                                onClick={handleVisibilityToggle}
                                title={`You are ${isOnline ? 'Online' : 'Offline'}`}
                                style={{ color: isOnline ? 'var(--wa-accent)' : 'var(--wa-secondary)' }}
                            >
                                <i className={`bi ${isOnline ? 'bi-toggle-on' : 'bi-toggle-off'}`}></i>
                            </button>
                        </div>
                    </div>

                    <div className="search-wrapper">
                        <i className="bi bi-search search-icon"></i>
                        <input
                            type="text"
                            className="search-input"
                            placeholder="Search or start new chat"
                            value={searchTerm || ''}
                        // Add onChange logic here if passed from parent, otherwise:
                        // onChange={(e) => setSearchTerm(e.target.value)} 
                        />
                    </div>
                </div>

                {/* --- LIST --- */}
                <div className="recent-calls-list">
                    {!user ? (
                        <div className="empty-state">Sign in to view your contacts.</div>
                    ) : filteredCalls.length === 0 ? (
                        <div className="empty-state">
                            <p>No chats found.</p>
                            <button className="btn btn-sm btn-outline-secondary mt-2" onClick={() => setStep(1)}>
                                Start a conversation
                            </button>
                        </div>
                    ) : (
                        filteredCalls.map(call => {
                            const isCurrentUserOwner = call.ownerId === user._id;
                            const displayName = isCurrentUserOwner ? call.recipientName : call.ownerName;
                            const displayEmail = isCurrentUserOwner ? call.recipientEmail : call.ownerEmail;

                            if (!displayName) return null;

                            return (
                                <div
                                    key={call.id}
                                    className="call-item"
                                    onClick={() => navigate(`/call/${call.id}`)} // Default click action (Video for now, or modify)
                                    onContextMenu={(e) => {
                                        e.preventDefault();
                                        // Set context menu position and target
                                        // You'll need to add state for contextMenu { x, y, callId, name }
                                        // For this example, I'll trigger the delete modal directly for simplicity
                                        // OR you can implement a real custom menu state. 
                                        // Let's assume we trigger the delete prompt directly on right click for now as per "don't show button directly"
                                        promptForDelete(call.id, displayName);
                                    }}
                                >
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

                                            {/* Date shows normally... */}
                                            <span className="call-date">{formatTimestamp(call.createdAt)}</span>

                                            {/* ...Buttons replace date on HOVER */}
                                            <div className="call-hover-actions">
                                                {/* Audio Call */}
                                                <button
                                                    className="action-icon"
                                                    title="Voice Call"
                                                    disabled={isCalling === call.id}
                                                    onClick={(e) => { e.stopPropagation(); handleReCall(call.id, displayName, displayEmail, call.description, '/audio-call/'); }}
                                                >
                                                    <i className="bi bi-telephone-fill"></i>
                                                </button>

                                                {/* Video Call */}
                                                <button
                                                    className="action-icon"
                                                    title="Video Call"
                                                    disabled={isCalling === call.id}
                                                    onClick={(e) => { e.stopPropagation(); handleReCall(call.id, displayName, displayEmail, call.description, '/call/'); }}
                                                >
                                                    <i className="bi bi-camera-video-fill"></i>
                                                </button>
                                            </div>
                                        </div>

                                        <div className="info-bottom">
                                            <span className="call-desc">
                                                {call.description || displayEmail}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            </div>

            {/* --- DELETE MODAL (Professional Look) --- */}
            {deleteTarget && (
                <div className="modal-overlay" onClick={() => setDeleteTarget(null)}>
                    <div className="modal-card" onClick={(e) => e.stopPropagation()}>
                        <h5 style={{ marginBottom: '10px' }}>Delete chat with "{deleteTarget.name}"?</h5>
                        <div className="d-flex justify-content-end gap-2 mt-4">
                            <button className="modal-btn btn-cancel" onClick={() => setDeleteTarget(null)}>Cancel</button>
                            <button className="modal-btn btn-danger" onClick={confirmDelete}>Delete</button>
                        </div>
                    </div>
                </div>
            )}

            {/* --- NOTIFICATION MODAL (Professional Look) --- */}
            {showNotificationModal && (
                <div className="modal-overlay" onClick={() => setShowNotificationModal(false)}>
                    <div className="modal-card" onClick={(e) => e.stopPropagation()}>
                        <div className="d-flex justify-content-between align-items-center mb-3">
                            <h5>Notifications</h5>
                            <button className="action-icon" onClick={() => setShowNotificationModal(false)}><i className="bi bi-x-lg"></i></button>
                        </div>
                        <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                            {allNotifications.length === 0 ? (
                                <p className="text-center" style={{ color: 'var(--wa-secondary)', padding: '20px' }}>No new notifications.</p>
                            ) : (
                                allNotifications.map(notif => (
                                    <div key={notif.id} className="p-3 border-bottom" style={{ borderColor: 'var(--wa-border)' }}>
                                        <div className="d-flex justify-content-between mb-1">
                                            <strong style={{ fontSize: '0.95rem', color: 'var(--wa-primary)' }}>{notif.callerName}</strong>
                                            <small style={{ fontSize: '0.75rem', color: 'var(--wa-secondary)' }}>{formatTimeAgo(notif.createdAt)}</small>
                                        </div>
                                        <div className="d-flex justify-content-between align-items-center">
                                            <span style={{ fontSize: '0.85rem', color: 'var(--wa-secondary)' }}>
                                                Incoming {notif.callType === 'audio' ? 'Voice' : 'Video'} Call
                                            </span>
                                            {notif.type === 'call' && (
                                                <button
                                                    className="btn btn-sm text-white"
                                                    style={{ backgroundColor: 'var(--wa-accent)', borderRadius: '4px' }}
                                                    onClick={() => {
                                                        const route = notif.callType === 'audio' ? '/audio-call/' : '/call/';
                                                        navigate(`${route}${notif.callId}`);
                                                        setShowNotificationModal(false);
                                                    }}
                                                >
                                                    Join
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