import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../firebaseConfig';
import {
    collection, query, where, orderBy, limit, onSnapshot,
    doc, setDoc, serverTimestamp, runTransaction, deleteDoc,
    updateDoc, addDoc, getDoc, writeBatch, getDocs
} from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { toast } from 'react-toastify';
import emailjs from '@emailjs/browser';

// --- NEW: Audio Context for Notification Sound ---
let audioContext = null;

const initAudioContext = () => {
    if (audioContext) return;
    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        if (audioContext.state === 'suspended') {
            audioContext.resume();
        }
        console.log("Audio Context Initialized by user gesture.");
    } catch (e) {
        console.error("Web Audio API is not supported in this browser.", e);
    }
};

const playNotificationSound = () => {
    if (!audioContext) {
        console.warn("Audio Context not initialized. User must click first.");
        return;
    }
    try {
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(900, audioContext.currentTime);
        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.5);
        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.5);
    } catch (e) {
        console.error("Error playing notification sound:", e);
    }
};

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
                <button className="btn btn-sm btn-light" onClick={onClose}>Dismiss</button>
                <button className="btn btn-sm btn-success" onClick={handleJoin}>Join Call</button>
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

    // --- Audio Init ---
    useEffect(() => {
        window.addEventListener('click', initAudioContext, { once: true });
        return () => window.removeEventListener('click', initAudioContext);
    }, []);

    // --- Toast Helper ---
    const showCallToast = useCallback((notification) => {
        playNotificationSound();
        const dismissToast = (id) => toast.dismiss(id);
        const toastId = toast(
            <CallNotification
                callerName={notification.callerName}
                callId={notification.callId}
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

            try {
                await addDoc(collection(db, 'notifications'), {
                    recipientEmail: recipientEmail,
                    callerName: `${user.firstname} ${user.lastname}`,
                    callerEmail: user.email,
                    callId: newCallId,
                    createdAt: serverTimestamp(),
                    status: 'pending',
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
        const participants = [user.email, otherEmail].sort();
        const conversationId = participants.join('_');
        const collectionName = 'direct_chats';
        navigate(`/chat/${collectionName}/${conversationId}`, {
            state: { recipientName: otherName }
        });
    };

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

    // Effect 5: Listen for PENDING (toast) notifications
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
                    showCallToast(notification);
                }
                batch.update(docSnap.ref, { status: 'unread' });
            });
            await batch.commit();
        });
        return () => unsubscribe();
    }, [user, showCallToast]);

    // Effect 6: Listen for UNREAD (bell) notifications
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

    // --- Helpers ---
    const formatTimestamp = (timestamp) => {
        if (!timestamp) return 'No date';
        if (timestamp && typeof timestamp.toDate === 'function') {
            return timestamp.toDate().toLocaleDateString('en-US', {
                month: 'short', day: 'numeric', year: 'numeric'
            });
        }
        return new Date(timestamp).toLocaleDateString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric'
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

    if (loading) {
        return (
            <div className="d-flex justify-content-center align-items-center py-5">
                <div className="spinner-border text-primary" role="status">
                    <span className="visually-hidden">Loading...</span>
                </div>
            </div>
        );
    }

    return (
        <>
            {/* Global & Component Styles */}
            <style jsx global>{`
                :root {
                    --bg-dark: #111b21;
                    --card-bg: #1f2937; /* Darker card background */
                    --text-primary: #e9edef;
                    --text-secondary: #8696a0;
                    --accent: #00a884; /* Cyan/Green */
                    --accent-glow: rgba(0, 168, 132, 0.4);
                    --danger: #ef5350;
                    --border-color: rgba(134, 150, 160, 0.15);
                }
                ::-webkit-scrollbar { width: 6px; }
                ::-webkit-scrollbar-track { background: transparent; }
                ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 3px; }
            `}</style>

            <style jsx>{`
                .recent-calls-container {
                    background-color: var(--bg-dark);
                    height: 100%;
                    display: flex;
                    flex-direction: column;
                    color: var(--text-primary);
                    overflow: hidden;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                }

                /* --- STICKY HEADER --- */
                .sticky-header {
                    position: sticky;
                    top: 0;
                    z-index: 100;
                    background-color: var(--bg-dark);
                    padding: 15px 20px 5px;
                    border-bottom: 1px solid var(--border-color);
                }

                /* --- SEARCH BAR (Matching Card Theme) --- */
                .search-wrapper {
                    margin-bottom: 10px;
                }
                .search-input-group {
                    background-color: var(--card-bg);
                    border-radius: 12px;
                    display: flex;
                    align-items: center;
                    padding: 0 15px;
                    height: 45px;
                    border: 1px solid transparent;
                    transition: border 0.3s ease;
                }
                .search-input-group:focus-within {
                    border-color: var(--accent);
                }
                .search-icon { color: var(--text-secondary); font-size: 1rem; }
                .search-input {
                    background: transparent;
                    border: none;
                    color: var(--text-primary);
                    width: 100%;
                    margin-left: 15px;
                    font-size: 1rem;
                    outline: none;
                }
                .search-input::placeholder { color: var(--text-secondary); }

                /* Stats Row */
                .stats-row {
                    display: flex; justify-content: space-between; align-items: center;
                    padding: 5px 0;
                    font-size: 0.85rem;
                    color: var(--text-secondary);
                }
                .bell-btn {
                    position: relative; cursor: pointer; color: var(--text-secondary); transition: 0.2s;
                    font-size: 1.2rem;
                }
                .bell-btn:hover { color: var(--text-primary); }
                .badge-dot {
                    position: absolute; top: -2px; right: -2px;
                    width: 8px; height: 8px;
                    background-color: var(--accent);
                    border-radius: 50%;
                }

                /* --- GRID LAYOUT FOR CARDS --- */
                .recent-calls-grid {
                    flex: 1;
                    overflow-y: auto;
                    padding: 20px;
                    display: grid;
                    /* Responsive Grid: Cards roughly 280px wide */
                    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
                    gap: 20px;
                    align-content: start;
                }

                /* --- CARD DESIGN --- */
                .call-card {
                    background-color: var(--card-bg);
                    border-radius: 16px;
                    padding: 20px;
                    display: flex;
                    flex-direction: column;
                    justify-content: space-between;
                    min-height: 180px;
                    border: 1px solid var(--border-color);
                    transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
                    position: relative;
                    cursor: pointer;
                }

                /* Hover Effect: Green Border + Lift (Matches 4th card style) */
                .call-card:hover {
                    border-color: var(--accent);
                    transform: translateY(-5px);
                    box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 0 0 1px var(--accent-glow);
                }

                /* Card Header: Icon/Avatar */
                .card-header-icon {
                    width: 48px;
                    height: 48px;
                    border-radius: 12px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 1.5rem;
                    font-weight: bold;
                    color: white;
                    margin-bottom: 15px;
                }

                /* Card Body: Text */
                .card-body {
                    flex: 1;
                }
                .card-title {
                    font-size: 1.2rem;
                    font-weight: 700;
                    color: var(--text-primary);
                    margin-bottom: 5px;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }
                .card-subtitle {
                    font-size: 0.9rem;
                    color: var(--text-secondary);
                    margin-bottom: 5px;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }
                .card-date {
                    font-size: 0.75rem;
                    color: #556066;
                    margin-bottom: 15px;
                }

                /* Card Actions (Bottom) */
                .card-actions {
                    display: flex;
                    gap: 10px;
                    padding-top: 15px;
                    border-top: 1px solid rgba(255,255,255,0.05);
                    opacity: 0.7;
                    transition: opacity 0.2s;
                }
                .call-card:hover .card-actions {
                    opacity: 1;
                }

                .action-btn {
                    background: transparent;
                    border: none;
                    color: var(--text-secondary);
                    font-size: 1.1rem;
                    cursor: pointer;
                    padding: 5px;
                    border-radius: 5px;
                    transition: all 0.2s;
                }
                .action-btn:hover { background-color: rgba(255,255,255,0.05); color: var(--text-primary); }
                .btn-call:hover { color: var(--accent); }
                .btn-delete:hover { color: var(--danger); }

                /* Empty State */
                .empty-state {
                    grid-column: 1 / -1;
                    padding: 40px; text-align: center; color: var(--text-secondary);
                }

                /* --- MODALS --- */
                .modal-overlay {
                    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
                    background: rgba(0,0,0,0.8); z-index: 1000;
                    display: flex; align-items: center; justify-content: center;
                    backdrop-filter: blur(2px);
                }
                .modal-card {
                    background: var(--card-bg); color: var(--text-primary);
                    width: 90%; max-width: 400px; padding: 25px;
                    border-radius: 16px; border: 1px solid var(--border-color);
                    box-shadow: 0 10px 40px rgba(0,0,0,0.6);
                }
                .modal-btn { padding: 10px 20px; border-radius: 8px; border: none; font-weight: 600; margin-left: 10px; cursor: pointer;}
                .btn-cancel { background: transparent; color: var(--text-secondary); border: 1px solid var(--border-color); }
                .btn-danger { background: var(--danger); color: white; }
                .btn-primary { background: var(--accent); color: white; }

            `}</style>

            <div className="recent-calls-container">

                {/* --- HEADER --- */}
                <div className="sticky-header">
                    <div className="search-wrapper">
                        <div className="search-input-group">
                            <i className="bi bi-search search-icon"></i>
                            <input
                                type="text"
                                className="search-input"
                                placeholder="Search contacts..."
                                value={searchTerm || ''}
                                // Assuming onChange is handled by parent or passed prop
                            />
                        </div>
                    </div>

                    <div className="stats-row">
                        <span>Daily Limit: {dailyCallCount}/{dailyCallLimit}</span>
                        <div className="bell-btn" onClick={openNotificationModal} title="Notifications">
                            <i className="bi bi-bell-fill"></i>
                            {unreadCount > 0 && <span className="badge-dot"></span>}
                        </div>
                    </div>
                </div>

                {/* --- GRID LIST --- */}
                <div className="recent-calls-grid">
                    {!user ? (
                        <div className="empty-state">Please log in to see contacts.</div>
                    ) : filteredCalls.length === 0 ? (
                        <div className="empty-state">No contacts found. Start a new call!</div>
                    ) : (
                        filteredCalls.map(call => {
                            const isCurrentUserOwner = call.ownerId === user._id;
                            const displayName = isCurrentUserOwner ? call.recipientName : call.ownerName;
                            const displayEmail = isCurrentUserOwner ? call.recipientEmail : call.ownerEmail;

                            if (!displayName) return null;

                            return (
                                <div key={call.id} className="call-card" onClick={() => navigate(`/call/${call.id}`)}>
                                    
                                    {/* Icon Top Left */}
                                    <div 
                                        className="card-header-icon"
                                        style={{ backgroundColor: getAvatarColor(displayName) }}
                                    >
                                        {displayName.charAt(0).toUpperCase()}
                                    </div>

                                    {/* Content */}
                                    <div className="card-body">
                                        <div className="card-title">{displayName}</div>
                                        <div className="card-subtitle">{displayEmail}</div>
                                        <div className="card-date">{formatTimestamp(call.createdAt)}</div>
                                    </div>

                                    {/* Actions Bottom */}
                                    <div className="card-actions" onClick={(e) => e.stopPropagation()}>
                                        <button
                                            className="action-btn btn-call"
                                            title="Video Call"
                                            disabled={isCalling === call.id}
                                            onClick={() => handleReCall(call.id, displayName, displayEmail, call.description)}
                                        >
                                            {isCalling === call.id ? (
                                                <span className="spinner-border spinner-border-sm"></span>
                                            ) : (
                                                <i className="bi bi-camera-video-fill"></i>
                                            )}
                                        </button>

                                        <button
                                            className="action-btn"
                                            title="Chat"
                                            onClick={() => handleOpenChat(displayName, displayEmail)}
                                        >
                                            <i className="bi bi-chat-left-text-fill"></i>
                                        </button>

                                        <button
                                            className="action-btn btn-delete"
                                            title="Delete"
                                            style={{ marginLeft: 'auto' }} // Push delete to right
                                            onClick={() => promptForDelete(call.id, displayName)}
                                        >
                                            <i className="bi bi-trash"></i>
                                        </button>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>

                {/* --- VISIBILITY TOGGLE (HIDDEN AS REQUESTED) --- */}
                {/* <div className="visibility-control">
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
                */}

            </div>

            {/* --- MODALS --- */}
            {deleteTarget && (
                <div className="modal-overlay" onClick={() => setDeleteTarget(null)}>
                    <div className="modal-card" onClick={(e) => e.stopPropagation()}>
                        <h5>Delete Contact?</h5>
                        <p style={{ color: 'var(--text-secondary)', marginBottom: '20px' }}>
                            Are you sure you want to delete <strong>{deleteTarget.name}</strong>?
                        </p>
                        <div className="d-flex justify-content-end">
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
                        <p style={{ color: 'var(--text-secondary)', marginBottom: '20px' }}>
                            Enabling this allows others to see you in the "Online Users" list.
                        </p>
                        <div className="d-flex justify-content-end">
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
                            <button className="action-btn" onClick={() => setShowNotificationModal(false)}><i className="bi bi-x-lg"></i></button>
                        </div>
                        <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                            {allNotifications.length === 0 ? (
                                <p className="text-center text-muted my-4">No notifications.</p>
                            ) : (
                                allNotifications.map(notif => (
                                    <div key={notif.id} className="p-2 border-bottom" style={{ borderColor: 'rgba(255,255,255,0.1)' }}>
                                        <div className="d-flex justify-content-between">
                                            <strong>{notif.callerName}</strong>
                                            <small className="text-muted">{formatTimeAgo(notif.createdAt)}</small>
                                        </div>
                                        <div className="d-flex justify-content-between align-items-center mt-1">
                                            <small style={{ color: 'var(--text-secondary)' }}>{notif.type === 'call' ? 'Incoming Call' : 'New Alert'}</small>
                                            {notif.type === 'call' && (
                                                <button className="action-btn btn-call" onClick={() => { navigate(`/call/${notif.callId}`); setShowNotificationModal(false); }}>
                                                    <i className="bi bi-camera-video-fill"></i>
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