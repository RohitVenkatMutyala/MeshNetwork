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
import Chat from './chat'; // New import for Chat component
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
    const [activeChat, setActiveChat] = useState(null);
    
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
        
        // Sort emails to ensure both users generate the same ID (e.g. "a@test.com_b@test.com")
        const participants = [user.email, otherEmail].sort();
        const conversationId = participants.join('_');

        setActiveChat({
            id: conversationId,
            name: otherName,
            collection: 'direct_chats'
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
            {/* Global styles */}
            <style jsx global>{`
                .form-control[placeholder="Search recent calls..."] {
                    height: 48px;
                    border-radius: 0 12px 12px 0 !important; 
                    padding-left: 2.5rem !important;
                    font-size: 0.95rem;
                }
                .input-group-text {
                    border-radius: 12px 0 0 12px !important;
                    height: 48px;
                }
                .btn-primary.btn-sm {
                    background-color: #4A69BD;
                    border-color: #4A69BD;
                    border-radius: 12px !important;
                    height: 48px;
                    width: 48px;
                    font-size: 1.25rem;
                }
                .btn-primary.btn-sm:hover {
                    background-color: #3e5aa8;
                    border-color: #3e5aa8;
                }
                .call-notification-toast {
                    padding: 4px;
                }
                .call-notification-toast p {
                    font-size: 0.9rem;
                    color: var(--bs-secondary-color);
                }
            `}</style>
            
            {/* Component styles */}
            <style jsx>{`
                .recent-calls-list {
                    max-height: 60vh;
                    overflow-y: auto;
                    padding: 0 1.25rem 1.25rem 1.25rem;
                }
                .call-item {
                    display: flex; align-items: center; padding: 1rem 1.25rem;
                    border: 1px solid var(--bs-border-color); 
                    transition: background-color 0.2s ease;
                    border-radius: 12px; margin-bottom: 0.5rem;
                }
                .call-item:last-child {
                    border-bottom: 1px solid var(--bs-border-color);
                    margin-bottom: 0;
                }
                .call-item:hover { background-color: var(--bs-tertiary-bg); }
                .call-avatar {
                    width: 40px; height: 40px; border-radius: 50%;
                    display: flex; align-items: center; justify-content: center;
                    font-weight: 600; color: white;
                    font-size: 1.2rem; flex-shrink: 0;
                }
                .call-info { margin-left: 1rem; flex-grow: 1; min-width: 0; }
                .call-name {
                    font-weight: 600; font-size: 1rem;
                    color: var(--bs-body-color); margin-bottom: 0.1rem;
                }
                .call-details {
                    font-size: 0.85rem; color: var(--bs-secondary-color);
                    display: flex; flex-wrap: wrap; align-items: center;
                }
                .call-email {
                    white-space: nowrap; overflow: hidden;
                    text-overflow: ellipsis; max-width: 100%;
                }
                .call-time { white-space: nowrap; }
                .call-time-separator { margin: 0 0.35rem; }
                .call-action {
                    margin-left: 1rem; flex-shrink: 0;
                    display: flex; align-items: center; gap: 0.4rem; 
                }
                .call-button {
                    background: none; border: none; font-size: 1.4rem; 
                    padding: 0.5rem; border-radius: 50%;
                    width: 44px; height: 44px;
                    display: flex; align-items: center; justify-content: center;
                    transition: all 0.2s ease; flex-shrink: 0; 
                }
                .call-button:disabled {
                    color: var(--bs-secondary-color) !important;
                    background-color: transparent !important;
                    cursor: not-allowed;
                }
                .call-button-rejoin { color: var(--bs-primary); }
                .call-button-rejoin:hover {
                    background-color: var(--bs-primary-bg-subtle);
                    color: var(--bs-primary-text-emphasis);
                }
                    .call-button-chat { color: #0dcaf0; } 
                .call-button-chat:hover { background-color: rgba(13, 202, 240, 0.15); color: #0dcaf0; }
                .call-button-call { color: var(--bs-success); }
                .call-button-call:hover {
                    background-color: var(--bs-success-bg-subtle);
                    color: var(--bs-success-text-emphasis);
                }
                .call-delete-button { color: #8a9199; }
                .call-delete-button:hover {
                    background-color: var(--bs-danger-bg-subtle);
                    color: var(--bs-danger-text-emphasis);
                }
                .empty-state {
                    padding: 2rem; text-align: center;
                    color: var(--bs-secondary-color);
                }
                .call-count-display {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 0.6rem 1rem;
                    background-color: var(--bs-tertiary-bg);
                    border-radius: 10px;
                    font-size: 0.9rem;
                    color: var(--bs-secondary-color);
                    font-weight: 500;
                    margin: 0.5rem 1.25rem 1rem 1.25rem; 
                }
                .call-count-display strong {
                    color: var(--bs-body-color);
                    font-weight: 600;
                }

                /* --- NEW: Notification Bell Styles --- */
                .notification-bell {
                    position: relative;
                    font-size: 1.3rem;
                    color: var(--bs-secondary-color);
                    cursor: pointer;
                    transition: color 0.2s;
                }
                .notification-bell:hover {
                    color: var(--bs-body-color);
                }
                .notification-badge {
                    position: absolute;
                    top: -5px;
                    right: -8px;
                    background-color: var(--bs-danger);
                    color: white;
                    width: 18px;
                    height: 18px;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 10px;
                    font-weight: 600;
                    border: 1px solid var(--bs-body-bg);
                }

                @media (max-width: 576px) {
                    .call-details {
                        flex-direction: column; align-items: flex-start; gap: 0.1rem;
                    }
                    .call-time-separator { display: none; }
                    .call-time { font-size: 0.75rem; padding-left: 26px; }
                    .call-item { padding: 1rem 0.75rem; }
                    .call-count-display { margin: 0.5rem 0.75rem 1rem 0.75rem; }
                    .recent-calls-list { padding: 0 0.75rem 0.75rem 0.75rem; }
                    .visibility-control {
                        flex-direction: column;
                        align-items: flex-start !important;
                        gap: 0.25rem;
                        margin: 0.5rem 0.75rem 1rem 0.75rem;
                    }
                }

                /* Modal Styles (Shared) */
                .delete-modal-overlay, .notification-modal-overlay {
                    position: absolute; top: 0; left: 0; right: 0; bottom: 0;
                    background: rgba(0, 0, 0, 0.6);
                    backdrop-filter: blur(5px);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 100;
                    border-radius: 0.5rem;
                }
                .delete-modal-card, .notification-modal-card {
                    background: var(--bs-body-bg);
                    border-radius: 12px;
                    padding: 0;
                    width: 90%;
                    max-width: 450px;
                    box-shadow: 0 5px 20px rgba(0,0,0,0.2);
                }
                .delete-modal-title, .notification-modal-title {
                    font-weight: 600;
                    font-size: 1.25rem;
                    color: var(--bs-body-color);
                    margin-bottom: 0.5rem;
                    padding: 1.5rem 1.5rem 0 1.5rem;
                }
                .delete-modal-body {
                    color: var(--bs-secondary-color);
                    margin-bottom: 1.5rem;
                    padding: 1rem 1.5rem 0 1.5rem;
                }
                .delete-modal-body strong { color: var(--bs-body-color); }
                .delete-modal-actions, .notification-modal-footer {
                    display: flex;
                    gap: 0.75rem;
                    justify-content: flex-end;
                    padding: 1.5rem;
                    background-color: var(--bs-tertiary-bg);
                    border-top: 1px solid var(--bs-border-color);
                    border-bottom-left-radius: 12px;
                    border-bottom-right-radius: 12px;
                }
                
                /* Notification Modal List Styles */
                .notification-modal-list {
                    max-height: 50vh;
                    overflow-y: auto;
                    padding: 0;
                    margin: 1rem 0 0 0;
                }
                .notification-item {
                    display: flex;
                    align-items: center;
                    padding: 1rem 1.5rem;
                    border-bottom: 1px solid var(--bs-border-color);
                }
                .notification-item:last-child {
                    border-bottom: none;
                }
                .notification-item.unread {
                    background-color: var(--bs-primary-bg-subtle);
                }
                .notification-icon {
                    font-size: 1.4rem;
                    margin-right: 1rem;
                }
                .notification-body {
                    flex-grow: 1;
                    font-size: 0.9rem;
                    color: var(--bs-secondary-color);
                }
                .notification-body strong {
                    color: var(--bs-body-color);
                }
                .notification-time {
                    font-size: 0.75rem;
                    color: var(--bs-secondary-color);
                }
                .notification-item.read .notification-body strong {
                    font-weight: 500;
                }
                .notification-item.read .notification-body {
                    color: var(--bs-secondary-color);
                }

                /* Visibility Toggle Switch */
                .visibility-control {
                    display: flex; align-items: center; justify-content: space-between;
                    padding: 0.75rem 1rem;
                    margin: 0 1.25rem 1rem 1.25rem;
                    background-color: var(--bs-tertiary-bg);
                    border-radius: 10px;
                    font-size: 0.9rem;
                    font-weight: 500;
                }
                .visibility-label { color: var(--bs-body-color); margin-bottom: 0; }
                .toggle-switch {
                    position: relative; display: inline-block;
                    width: 44px; height: 24px; flex-shrink: 0;
                }
                .toggle-switch input { opacity: 0; width: 0; height: 0; }
                .toggle-slider {
                    position: absolute; cursor: pointer;
                    top: 0; left: 0; right: 0; bottom: 0;
                    background-color: #ccc;
                    transition: .4s;
                    border-radius: 24px;
                }
                .toggle-slider:before {
                    position: absolute; content: "";
                    height: 18px; width: 18px; left: 3px; bottom: 3px;
                    background-color: white; transition: .4s;
                    border-radius: 50%;
                }
                
                /* --- MODIFIED: Use theme color for toggle --- */
                input:checked + .toggle-slider {
                    background-color: var(--bs-primary); /* Changed from green */
                }
                input:checked + .toggle-slider:before { transform: translateX(20px); }
                input:disabled + .toggle-slider {
                    background-color: #e9ecef; cursor: not-allowed;
                }

                .visibility-modal-body {
                    color: var(--bs-secondary-color);
                    margin-bottom: 1.5rem;
                    font-size: 0.95rem;
                    line-height: 1.6;
                    padding: 1rem 1.5rem 0 1.5rem;
                }
            `}</style>
            
            {/* --- Visibility Confirmation Modal --- */}
            {showVisibilityModal && (
                <div className="notification-modal-overlay" onClick={handleCloseVisibilityModal}>
                    <div className="notification-modal-card" onClick={(e) => e.stopPropagation()}>
                        <h5 className="notification-modal-title">Profile Visibility</h5>
                        <p className="visibility-modal-body">
                            By enabling "Profile Visibility," you are allowing other users
                            on the app to see that you are online and available.
                            <br/><br/>
                            Your profile (name and email) may appear in their
                            "Online Users" list, making it easier to start a call.
                            You can turn this off at any time.
                        </p>
                        <div className="notification-modal-footer">
                            <button 
                                className="btn btn-primary" 
                                onClick={handleCloseVisibilityModal}
                            >
                                Got it
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* --- Delete Confirmation Modal --- */}
            {deleteTarget && (
                <div className="delete-modal-overlay" onClick={() => setDeleteTarget(null)}>
                    <div className="delete-modal-card" onClick={(e) => e.stopPropagation()}>
                        <h5 className="delete-modal-title">Delete Contact?</h5>
                        <p className="delete-modal-body">
                            Are you sure you want to delete <strong>{deleteTarget.name}</strong> from your recents? This cannot be undone.
                        </p>
                        <div className="delete-modal-actions">
                            <button 
                                className="btn btn-secondary" 
                                onClick={() => setDeleteTarget(null)}
                                disabled={isDeleting === deleteTarget.id}
                            >
                                Cancel
                            </button>
                            <button 
                                className="btn btn-danger" 
                                onClick={confirmDelete}
                                disabled={isDeleting === deleteTarget.id}
                            >
                                {isDeleting === deleteTarget.id ? 'Deleting...' : 'Delete'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* --- Notification Bell Modal --- */}
            {showNotificationModal && (
                <div className="notification-modal-overlay" onClick={() => setShowNotificationModal(false)}>
                    <div className="notification-modal-card" onClick={(e) => e.stopPropagation()}>
                        <h5 className="notification-modal-title">Notifications</h5>
                        <div className="notification-modal-list">
                            {isNotifModalLoading ? (
                                <div className="text-center p-5">
                                    <div className="spinner-border spinner-border-sm" role="status">
                                        <span className="visually-hidden">Loading...</span>
                                    </div>
                                </div>
                            ) : allNotifications.length === 0 ? (
                                <div className="text-center p-5 text-muted">
                                    You have no notifications.
                                </div>
                            ) : (
                                allNotifications.map(notif => (
                                    <div 
                                        key={notif.id} 
                                        className={`notification-item ${notif.status}`}
                                    >
                                        <div className="notification-icon">
                                            {notif.type === 'call' ? (
                                                <i className="bi bi-telephone-fill text-success"></i>
                                            ) : (
                                                <i className="bi bi-info-circle-fill text-primary"></i>
                                            )}
                                        </div>
                                        <div className="notification-body">
                                            <div className="mb-1">
                                                <strong>{notif.callerName}</strong>
                                                {notif.type === 'call' ? ' invited you to a call.' : ' sent you a notification.'}
                                            </div>
                                            <div className="notification-time">
                                                {formatTimeAgo(notif.createdAt)}
                                            </div>
         
                                        </div>
                                        {notif.type === 'call' && (
                                            <button 
                                                className="btn btn-sm btn-primary ms-auto"
                                                onClick={() => {
                                                    navigate(`/call/${notif.callId}`);
                                                    setShowNotificationModal(false);
                                                }}
                                            >
                                               <span style={{ color: "limegreen" }}>📞</span>

                                            </button>
                                        )}
                                    </div>
                                ))
                            )}
                        </div>
                        <div className="notification-modal-footer">
                            <button 
                                className="btn btn-secondary" 
                                onClick={() => setShowNotificationModal(false)}
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
           {activeChat && (
                <Chat 
                    chatId={activeChat.id} 
                    collectionName={activeChat.collection} 
                    recipientName={activeChat.name}
                    onClose={() => setActiveChat(null)} 
                />
            )}

            {/* --- Visibility Toggle --- */}
            <div className="visibility-control">
                <label htmlFor="visibility-toggle" className="visibility-label">
                    Profile Visibility
                </label>
                <label className="toggle-switch">
                    <input 
                        type="checkbox" 
                        id="visibility-toggle"
                        checked={isOnline} 
                        onChange={handleVisibilityToggle}
                        disabled={isVisibilityLoading}
                    />
                    <span className="toggle-slider"></span>
                </label>
            </div>

            {/* --- Call Count Display (with Bell) --- */}
            <div className="call-count-display">
                <div>
                    Today's Calls: <strong>{dailyCallCount} / {dailyCallLimit}</strong>
                </div>
                <div 
                    className="notification-bell" 
                    title="Notifications"
                    onClick={openNotificationModal}
                >
                    <i className="bi bi-bell-fill"></i>
                    {unreadCount > 0 && (
                        <span className="notification-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>
                    )}
                </div>
            </div>

            {/* --- Recent Calls List --- */}
            <div className="recent-calls-list">
                {!user ? (
                    <div className="empty-state">Please log in to see recent calls.</div>
                ) : filteredCalls.length === 0 ? (
                    <div className="empty-state">
                        {searchTerm ? "No calls match your search." : "You have no recent calls."}
                    </div>
                ) : (
                    filteredCalls.map(call => {
                        const isCurrentUserOwner = call.ownerId === user._id;
                        const displayName = isCurrentUserOwner ? call.recipientName : call.ownerName;
                        const displayEmail = isCurrentUserOwner ? call.recipientEmail : call.ownerEmail;
                        
                        if (!displayName) return null;

                        return (
                            <div key={call.id} className="call-item">
                                <div 
                                    className="call-avatar" 
                                    style={{ backgroundColor: getAvatarColor(displayName) }}
                                >
                                    {displayName.charAt(0).toUpperCase()}
                                </div>
                                <div className="call-info">
                                    <div className="call-name">{displayName}</div>
                                    <div className="call-details">
                                        <span className="call-email">
                                            <i className="bi bi-envelope-fill me-2"></i>
                                            {displayEmail}
                                        </span>
                                        <span className="call-time-separator d-none d-sm-inline"> • </span>
                                        <span className="call-time">{formatTimestamp(call.createdAt)}</span>
                                    </div>
                                </div>

                                <div className="call-action">
                                    {/* 1. Re-join button */}
                                    <button
                                        className="call-button call-button-rejoin"
                                        title={`Re-join session ${call.id}`}
                                        onClick={(e) => {
                                            e.preventDefault();
                                            navigate(`/call/${call.id}`);
                                        }}
                                    >
                                        <i className="bi bi-box-arrow-in-right"></i>
                                    </button>

                                    {/* 2. The "new call" button */}
                                    <button 
                                        className="call-button call-button-call" 
                                        title={`Call ${displayName} (New Session)`}
                                        onClick={() => handleReCall(call.id, displayName, displayEmail, call.description)}
                                        disabled={isCalling === call.id || dailyCallCount >= dailyCallLimit || isDeleting === call.id}
                                    >
                                        {isCalling === call.id ? (
                                            <div className="spinner-border spinner-border-sm" role="status">
                                                <span className="visually-hidden">Calling...</span>
                                            </div>
                                        ) : (
                                            <i className="bi bi-telephone-fill"></i>
                                        )}
                                    </button>
                                    <button 
                                    className="call-button call-button-chat" 
                                    title={`Chat with ${displayName}`}
                                    onClick={() => handleOpenChat(displayName, displayEmail)}
                                >
                                    <i className="bi bi-chat-dots-fill"></i>
                                </button>

                                    {/* 3. Delete button */}
                                    <button 
                                        className="call-button call-delete-button" 
                                        title={`Delete ${displayName}`}
                                        onClick={() => promptForDelete(call.id, displayName)}
                                        disabled={isDeleting === call.id || isCalling === call.id}
                                    >
                                        {isDeleting === call.id ? (
                                            <div className="spinner-border spinner-border-sm" role="status">
                                                <span className="visually-hidden">Deleting...</span>
                                            </div>
                                        ) : (
                                            <i className="bi bi-trash-fill"></i>
                                        )}
                                    </button>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
        </>
    );
}

export default RecentCalls;