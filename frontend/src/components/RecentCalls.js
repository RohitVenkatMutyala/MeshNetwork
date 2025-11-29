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
// --- NEW: State for Add Contact Modal ---
    const [showAddModal, setShowAddModal] = useState(false);
    const [newContact, setNewContact] = useState({ name: '', email: '', desc: '' });

    // Helper to start a call from the Add Modal
    const handleStartNewChat = () => {
        if(!newContact.name || !newContact.email) {
            toast.warn("Name and Email are required");
            return;
        }
        // Reuse your existing handleReCall function to create the call
        handleReCall(
            null, // callId (null creates a new one)
            newContact.name, 
            newContact.email, 
            newContact.desc || "New Chat", 
            '/call/' // Default to video, or change to audio if you prefer
        );
        setShowAddModal(false);
        setNewContact({ name: '', email: '', desc: '' });
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

    // --- NEW STATE: Add Contact Modal ---
    const [showAddModal, setShowAddModal] = useState(false);
    const [newContact, setNewContact] = useState({ name: '', email: '', desc: '' });

    // --- NEW STATE: Context Menu (Right Click) ---
    const [contextMenu, setContextMenu] = useState({ visible: false, x: 0, y: 0, callId: null, name: null });

    // --- HELPER: Handle Right Click ---
    const handleContextMenu = (e, callId, name) => {
        e.preventDefault();
        setContextMenu({ visible: true, x: e.pageX, y: e.pageY, callId, name });
    };

    // --- HELPER: Close Context Menu on Click ---
    useEffect(() => {
        const handleClick = () => setContextMenu({ ...contextMenu, visible: false });
        window.addEventListener('click', handleClick);
        return () => window.removeEventListener('click', handleClick);
    }, [contextMenu]);

    // --- HELPER: Create Call from Modal ---
    const handleStartNewChat = () => {
        if(!newContact.name || !newContact.email) {
            toast.warn("Name and Email are required");
            return;
        }
        handleReCall(null, newContact.name, newContact.email, newContact.desc || "New Chat", '/call/');
        setShowAddModal(false);
        setNewContact({ name: '', email: '', desc: '' });
    };
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
            {/* --- GLOBAL STYLES & THEME --- */}
            <style jsx global>{`
                :root {
                    /* --- Light Theme --- */
                    --wa-bg: #f0f2f5; /* Light Grey Background */
                    --wa-header: #ffffff;
                    --wa-card-bg: #ffffff;
                    --wa-border: #e9edef;
                    --wa-hover: #f5f6f6;
                    --wa-primary: #111b21;
                    --wa-secondary: #667781;
                    --wa-accent: #00a884; /* Teal */
                    --wa-danger: #ea0038;
                    --wa-input-bg: #f0f2f5;
                }

                /* --- Dark Theme --- */
                [data-theme='dark'] {
                    --wa-bg: #111b21; /* Deep Background */
                    --wa-header: #202c33;
                    --wa-card-bg: #202c33;
                    --wa-border: rgba(134, 150, 160, 0.15);
                    --wa-hover: #2a3942;
                    --wa-primary: #e9edef;
                    --wa-secondary: #8696a0;
                    --wa-accent: #00a884;
                    --wa-input-bg: #2a3942;
                }

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
                    color: var(--wa-primary);
                    position: relative;
                    overflow: hidden;
                    transition: background-color 0.3s ease;
                }

                /* --- HEADER --- */
                .sticky-header {
                    position: sticky;
                    top: 0;
                    z-index: 100;
                    background-color: var(--wa-header);
                    padding: 15px 20px;
                    border-bottom: 1px solid var(--wa-border);
                    box-shadow: 0 2px 5px rgba(0,0,0,0.03);
                }

                .header-content {
                    display: flex;
                    gap: 15px;
                    align-items: center;
                    width: 100%;
                }

                /* Search Bar */
                .search-wrapper {
                    flex-grow: 1;
                    position: relative;
                }
                .search-input {
                    width: 100%;
                    background-color: var(--wa-input-bg);
                    border: 1px solid transparent;
                    border-radius: 8px;
                    padding: 10px 15px 10px 40px;
                    color: var(--wa-primary);
                    font-size: 0.95rem;
                    outline: none;
                    transition: all 0.2s;
                }
                .search-input:focus {
                    background-color: var(--wa-header);
                    border-color: var(--wa-accent);
                    box-shadow: 0 0 0 2px rgba(0, 168, 132, 0.2);
                }
                .search-icon {
                    position: absolute;
                    left: 14px;
                    top: 50%;
                    transform: translateY(-50%);
                    color: var(--wa-secondary);
                }

                /* Header Buttons */
                .header-btn {
                    width: 40px;
                    height: 40px;
                    border-radius: 50%;
                    border: none;
                    background-color: var(--wa-input-bg);
                    color: var(--wa-secondary);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 1.2rem;
                    cursor: pointer;
                    transition: all 0.2s;
                    position: relative;
                }
                .header-btn:hover {
                    background-color: var(--wa-hover);
                    color: var(--wa-accent);
                    transform: translateY(-1px);
                }
                .badge-dot {
                    position: absolute; top: 2px; right: 2px;
                    width: 10px; height: 10px;
                    background-color: var(--wa-danger);
                    border-radius: 50%;
                    border: 2px solid var(--wa-header);
                }

                /* --- LIST AREA --- */
                .recent-calls-list {
                    flex: 1;
                    overflow-y: auto;
                    padding: 15px;
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); /* Responsive Grid */
                    gap: 15px;
                    align-content: start;
                }

                /* --- CARD DESIGN (Matches Login Features) --- */
                .call-card {
                    background-color: var(--wa-card-bg);
                    border: 1px solid var(--wa-border);
                    border-radius: 12px;
                    padding: 15px;
                    display: flex;
                    align-items: center;
                    cursor: pointer;
                    transition: all 0.2s ease;
                    position: relative;
                    box-shadow: 0 2px 6px rgba(0,0,0,0.02);
                }
                .call-card:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 5px 15px rgba(0,0,0,0.08);
                    border-color: var(--wa-accent);
                }

                .avatar-container { margin-right: 15px; position: relative; }
                .call-avatar {
                    width: 50px; height: 50px;
                    border-radius: 12px; /* Square-ish rounded like feature icons */
                    display: flex; align-items: center; justify-content: center;
                    font-weight: 600; color: white; font-size: 1.3rem;
                    box-shadow: 0 4px 10px rgba(0,0,0,0.1);
                }

                .call-info {
                    flex: 1; min-width: 0;
                }
                .call-name {
                    font-size: 1rem;
                    font-weight: 600;
                    color: var(--wa-primary);
                    margin-bottom: 2px;
                    display: block;
                    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
                }
                .call-desc {
                    font-size: 0.85rem;
                    color: var(--wa-secondary);
                    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
                    display: block;
                }

                /* Hover Actions (Quick Buttons) */
                .card-actions {
                    display: flex;
                    gap: 8px;
                    opacity: 0;
                    transition: opacity 0.2s;
                }
                .call-card:hover .card-actions { opacity: 1; }

                .mini-btn {
                    width: 32px; height: 32px;
                    border-radius: 8px;
                    border: none;
                    display: flex; align-items: center; justify-content: center;
                    cursor: pointer;
                    font-size: 0.9rem;
                    transition: 0.2s;
                }
                .btn-audio { background: rgba(0, 168, 132, 0.1); color: var(--wa-accent); }
                .btn-audio:hover { background: var(--wa-accent); color: white; }
                
                .btn-video { background: rgba(83, 189, 235, 0.1); color: var(--wa-blue); }
                .btn-video:hover { background: var(--wa-blue); color: white; }

                /* Context Menu (Right Click) */
                .context-menu {
                    position: fixed;
                    background: var(--wa-card-bg);
                    border: 1px solid var(--wa-border);
                    border-radius: 8px;
                    box-shadow: 0 5px 20px rgba(0,0,0,0.2);
                    z-index: 9999;
                    min-width: 150px;
                    padding: 5px 0;
                    animation: fadeIn 0.1s ease;
                }
                .ctx-item {
                    padding: 10px 20px;
                    cursor: pointer;
                    font-size: 0.9rem;
                    display: flex; align-items: center; gap: 10px;
                    color: var(--wa-primary);
                }
                .ctx-item:hover { background-color: var(--wa-hover); }
                .ctx-danger { color: var(--wa-danger); }
                
                /* Empty State */
                .empty-state {
                    grid-column: 1 / -1;
                    padding: 60px;
                    text-align: center;
                    color: var(--wa-secondary);
                }
                .empty-icon { font-size: 3rem; margin-bottom: 15px; opacity: 0.5; }

                /* --- MODALS --- */
                .modal-overlay {
                    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
                    background: rgba(0,0,0,0.6); z-index: 2000;
                    display: flex; align-items: center; justify-content: center;
                    backdrop-filter: blur(3px);
                }
                .modal-card {
                    background: var(--wa-card-bg); color: var(--wa-primary);
                    width: 90%; max-width: 400px; padding: 25px;
                    border-radius: 16px; box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                    border: 1px solid var(--wa-border);
                }
                .modal-input {
                    width: 100%; padding: 12px; margin-bottom: 12px;
                    background: var(--wa-input-bg); border: 1px solid var(--wa-border);
                    color: var(--wa-primary); border-radius: 8px; outline: none;
                }
                .modal-input:focus { border-color: var(--wa-accent); }
                .modal-footer { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }
                .btn-custom { padding: 8px 20px; border-radius: 8px; border: none; font-weight: 600; transition: 0.2s; }
                .btn-cancel { background: transparent; color: var(--wa-secondary); }
                .btn-cancel:hover { background: var(--wa-hover); color: var(--wa-primary); }
                .btn-primary { background: var(--wa-accent); color: white; }
                .btn-primary:hover { background: #006e5a; }
                .btn-danger { background: var(--wa-danger); color: white; }
            `}</style>

            <div className="recent-calls-container">
                
                {/* --- HEADER --- */}
                <div className="sticky-header">
                    <div className="header-content">
                        {/* Search */}
                        <div className="search-wrapper">
                            <i className="bi bi-search search-icon"></i>
                            <input 
                                type="text" 
                                className="search-input" 
                                placeholder="Search contacts..."
                                value={searchTerm || ''}
                                onChange={(e) => typeof setSearchTerm === 'function' ? setSearchTerm(e.target.value) : null}
                            />
                        </div>

                        {/* Action Buttons */}
                        <button className="header-btn" title="Add New Contact" onClick={() => setShowAddModal(true)}>
                            <i className="bi bi-plus-lg"></i>
                        </button>
                        <button className="header-btn" onClick={openNotificationModal} title="Notifications">
                            <i className="bi bi-bell"></i>
                            {unreadCount > 0 && <span className="badge-dot"></span>}
                        </button>
                        <button 
                            className="header-btn" 
                            onClick={handleVisibilityToggle}
                            title={`You are ${isOnline ? 'Online' : 'Offline'}`}
                            style={{ color: isOnline ? 'var(--wa-accent)' : 'var(--wa-secondary)' }}
                        >
                            <i className={`bi ${isOnline ? 'bi-toggle-on' : 'bi-toggle-off'}`}></i>
                        </button>
                    </div>
                </div>

                {/* --- CARD GRID --- */}
                <div className="recent-calls-list">
                    {!user ? (
                        <div className="empty-state">
                            <div className="empty-icon"><i className="bi bi-person-lock"></i></div>
                            <h4>Sign In Required</h4>
                            <p>Please sign in to view your contacts.</p>
                        </div>
                    ) : filteredCalls.length === 0 ? (
                        <div className="empty-state">
                            <div className="empty-icon"><i className="bi bi-chat-square-dots"></i></div>
                            <h4>No Chats Yet</h4>
                            <p>Start a new conversation to see it here.</p>
                            <button className="btn btn-primary btn-custom mt-3" onClick={() => setShowAddModal(true)}>
                                Add Contact
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
                                    className="call-card" 
                                    // Default action: Go to video call
                                    onClick={() => navigate(`/call/${call.id}`)}
                                    // Right Click Logic
                                    onContextMenu={(e) => handleContextMenu(e, call.id, displayName)}
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
                                        <span className="call-name">{displayName}</span>
                                        <span className="call-desc">{call.description || displayEmail}</span>
                                    </div>

                                    {/* Quick Actions on Hover */}
                                    <div className="card-actions">
                                        <button 
                                            className="mini-btn btn-audio" 
                                            title="Voice Call"
                                            disabled={isCalling === call.id}
                                            onClick={(e) => { e.stopPropagation(); handleReCall(call.id, displayName, displayEmail, call.description, '/audio-call/'); }}
                                        >
                                            <i className="bi bi-telephone-fill"></i>
                                        </button>

                                        <button 
                                            className="mini-btn btn-video" 
                                            title="Video Call"
                                            disabled={isCalling === call.id}
                                            onClick={(e) => { e.stopPropagation(); handleReCall(call.id, displayName, displayEmail, call.description, '/call/'); }}
                                        >
                                            <i className="bi bi-camera-video-fill"></i>
                                        </button>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            </div>

            {/* --- RIGHT CLICK CONTEXT MENU --- */}
            {contextMenu.visible && (
                <div 
                    className="context-menu" 
                    style={{ top: contextMenu.y, left: contextMenu.x }}
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="ctx-item" onClick={() => {
                        navigate(`/call/${contextMenu.callId}`);
                        setContextMenu({ ...contextMenu, visible: false });
                    }}>
                        <i className="bi bi-camera-video"></i> Video Call
                    </div>
                    <div className="ctx-item" onClick={() => {
                        navigate(`/audio-call/${contextMenu.callId}`);
                        setContextMenu({ ...contextMenu, visible: false });
                    }}>
                        <i className="bi bi-telephone"></i> Audio Call
                    </div>
                    <div style={{height: '1px', background: 'var(--wa-border)', margin: '4px 0'}}></div>
                    <div className="ctx-item ctx-danger" onClick={() => {
                        promptForDelete(contextMenu.callId, contextMenu.name);
                        setContextMenu({ ...contextMenu, visible: false });
                    }}>
                        <i className="bi bi-trash"></i> Delete
                    </div>
                </div>
            )}

            {/* --- ADD CONTACT MODAL --- */}
            {showAddModal && (
                <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
                    <div className="modal-card" onClick={(e) => e.stopPropagation()}>
                        <h4 style={{marginBottom:'20px', fontWeight: '700'}}>New Chat</h4>
                        
                        <input 
                            className="modal-input" 
                            placeholder="Name (e.g., Jane Doe)"
                            value={newContact.name} 
                            onChange={(e) => setNewContact({...newContact, name: e.target.value})}
                        />
                        <input 
                            className="modal-input" 
                            placeholder="Email (e.g., jane@example.com)"
                            value={newContact.email} 
                            onChange={(e) => setNewContact({...newContact, email: e.target.value})}
                        />
                        <input 
                            className="modal-input" 
                            placeholder="Description (Optional)"
                            value={newContact.desc} 
                            onChange={(e) => setNewContact({...newContact, desc: e.target.value})}
                        />

                        <div className="modal-footer">
                            <button className="btn-custom btn-cancel" onClick={() => setShowAddModal(false)}>Cancel</button>
                            <button className="btn-custom btn-primary" onClick={handleStartNewChat}>Create Chat</button>
                        </div>
                    </div>
                </div>
            )}

            {/* --- DELETE MODAL --- */}
            {deleteTarget && (
                <div className="modal-overlay" onClick={() => setDeleteTarget(null)}>
                    <div className="modal-card" onClick={(e) => e.stopPropagation()}>
                        <h5 style={{marginBottom: '10px'}}>Delete "{deleteTarget.name}"?</h5>
                        <p style={{color: 'var(--wa-secondary)', fontSize: '0.9rem'}}>
                            This will permanently remove the chat history from your list.
                        </p>
                        <div className="modal-footer">
                            <button className="btn-custom btn-cancel" onClick={() => setDeleteTarget(null)}>Cancel</button>
                            <button className="btn-custom btn-danger" onClick={confirmDelete}>Delete</button>
                        </div>
                    </div>
                </div>
            )}

            {/* --- NOTIFICATION MODAL --- */}
            {showNotificationModal && (
                <div className="modal-overlay" onClick={() => setShowNotificationModal(false)}>
                    <div className="modal-card" onClick={(e) => e.stopPropagation()}>
                        <div className="d-flex justify-content-between align-items-center mb-3">
                            <h5>Notifications</h5>
                            <button className="action-icon" onClick={() => setShowNotificationModal(false)}><i className="bi bi-x-lg"></i></button>
                        </div>
                        <div style={{maxHeight: '300px', overflowY: 'auto'}}>
                            {allNotifications.length === 0 ? (
                                <p className="text-center" style={{color: 'var(--wa-secondary)', padding: '20px'}}>No new notifications.</p>
                            ) : (
                                allNotifications.map(notif => (
                                    <div key={notif.id} className="p-3 border-bottom" style={{borderColor: 'var(--wa-border)'}}>
                                        <div className="d-flex justify-content-between mb-1">
                                            <strong style={{fontSize:'0.95rem', color: 'var(--wa-primary)'}}>{notif.callerName}</strong>
                                            <small style={{fontSize:'0.75rem', color: 'var(--wa-secondary)'}}>{formatTimeAgo(notif.createdAt)}</small>
                                        </div>
                                        <div className="d-flex justify-content-between align-items-center">
                                            <span style={{fontSize:'0.85rem', color: 'var(--wa-secondary)'}}>
                                                Incoming {notif.callType === 'audio' ? 'Voice' : 'Video'} Call
                                            </span>
                                            {notif.type === 'call' && (
                                                <button 
                                                    className="btn btn-sm text-white" 
                                                    style={{backgroundColor: 'var(--wa-accent)', borderRadius: '4px'}}
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