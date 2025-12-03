import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../firebaseConfig';
import {
    collection, query, where, orderBy, limit, onSnapshot,
    doc, setDoc, serverTimestamp, runTransaction, deleteDoc,
    writeBatch, getDocs, addDoc
} from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { toast } from 'react-toastify';
import emailjs from '@emailjs/browser';

// --- DRAG & DROP IMPORTS ---
import { 
  DndContext, 
  closestCenter, 
  KeyboardSensor, 
  PointerSensor, 
  useSensor, 
  useSensors, 
  TouchSensor 
} from '@dnd-kit/core';
import { 
  arrayMove, 
  SortableContext, 
  sortableKeyboardCoordinates, 
  rectSortingStrategy, 
  useSortable 
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// --- SOUND LOGIC ---
let audioContext = null;

const initAudioContext = () => {
    if (audioContext) return;
    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        if (audioContext.state === 'suspended') {
            audioContext.resume();
        }
    } catch (e) {
        console.error("Audio API not supported", e);
    }
};

const playNotificationSound = () => {
    if (!audioContext) {
        initAudioContext();
        if (!audioContext) return;
    }

    try {
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(1200, audioContext.currentTime + 0.1);

        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.5);

        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.5);
    } catch (e) {
        console.error("Sound play error", e);
    }
};

// --- HELPER: TIME AGO ---
const formatTimeAgo = (timestamp) => {
    if (!timestamp) return 'Just now';
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
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
    if (interval > 1) return Math.floor(interval) + "m ago";
    return "Just now";
};

// --- TOAST COMPONENT ---
const CallNotification = ({ callerName, callId, callType, onClose, navigate }) => {
    const handleJoin = () => {
        navigate(`/call/${callId}`);
        onClose();
    };

    const isGroup = callType === 'group';
    const btnClass = isGroup ? 'glass-btn-purple' : 'glass-btn-green';

    return (
        <div className="d-flex flex-column">
            <style jsx>{`
                .glass-btn-green {
                    background: linear-gradient(135deg, rgba(0, 168, 132, 0.6), rgba(0, 143, 111, 0.8));
                    border: 1px solid rgba(255, 255, 255, 0.2); color: white;
                }
                .glass-btn-purple {
                    background: linear-gradient(135deg, rgba(111, 66, 193, 0.6), rgba(89, 53, 154, 0.8));
                    border: 1px solid rgba(255, 255, 255, 0.2); color: white;
                }
            `}</style>
            <strong className="mb-1">{callerName} is calling!</strong>
            <div className="d-flex justify-content-end gap-2 mt-2">
                <button className="btn btn-sm btn-secondary" onClick={onClose} style={{ fontSize: '0.8rem' }}>Dismiss</button>
                <button
                    className={`btn btn-sm ${btnClass}`}
                    style={{ fontSize: '0.8rem', padding: '5px 15px', borderRadius: '12px' }}
                    onClick={handleJoin}
                >
                    Join
                </button>
            </div>
        </div>
    );
};

// --- SORTABLE CARD COMPONENT ---
const SortableCallCard = ({ call, user, isCalling, handleReCall, handleOpenChat, setDeleteTarget, navigate, getAvatarColor }) => {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({ id: call.id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        touchAction: 'pan-y', 
        position: 'relative',
        zIndex: isDragging ? 999 : 'auto'
    };

    const isGroup = call.type === 'group';
    const isOwner = call.ownerId === user._id;
    const displayTitle = isGroup ? call.description : (isOwner ? call.recipientName : call.ownerName);
    const displaySubtitle = isGroup ? `${call.allowedEmails.length} Participants` : (isOwner ? call.recipientEmail : call.ownerEmail);
    const canDelete = isGroup ? isOwner : true;

    const actionBtnClass = isGroup ? 'icon-btn-purple' : 'icon-btn-green';

    if (!displayTitle) return null;

    const handleVideoAction = (e) => {
        e.stopPropagation(); 
        e.preventDefault();
        
        if (isGroup && !isOwner) {
            navigate(`/call/${call.id}`);
        } else {
            handleReCall(call);
        }
    };

    return (
        <div 
            ref={setNodeRef} 
            style={style} 
            {...attributes} 
            {...listeners} 
            className={`call-card ${isGroup ? 'joint-meet' : ''}`}
        >
            <span className={`badge ${isGroup ? 'badge-joint' : 'badge-meeting'}`}>
                {isGroup ? 'Joint Meeting' : 'Meeting'}
            </span>

            <div className="card-header-icon" style={{ backgroundColor: getAvatarColor(displayTitle) }}>
                {isGroup ? <i className="bi bi-people-fill"></i> : displayTitle.charAt(0).toUpperCase()}
            </div>
            <div style={{ flex: 1, zIndex: 2 }}>
                <div className="card-title">{displayTitle}</div>
                <div className="card-subtitle">{displaySubtitle}</div>
                <div className="card-date">{formatTimeAgo(call.createdAt)}</div>
            </div>

            <div className="card-actions">
                <button 
                    className={`action-btn ${actionBtnClass}`}
                    title={isGroup && !isOwner ? "Join Meeting" : "Start Video Call"} 
                    disabled={isCalling === call.id} 
                    onPointerDown={(e) => e.stopPropagation()} 
                    onClick={handleVideoAction}
                >
                    {isCalling === call.id ? <span className="spinner-border spinner-border-sm" style={{width: '1rem', height: '1rem'}}></span> : <i className="bi bi-camera-video-fill"></i>}
                </button>

                {isOwner && (
                    <button 
                        className={`action-btn ${actionBtnClass}`}
                        title="Re-Enter Room" 
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => { e.stopPropagation(); navigate(`/call/${call.id}`); }}
                    >
                        <i className="bi bi-box-arrow-in-right"></i>
                    </button>
                )}

                <button 
                    className={`action-btn ${actionBtnClass}`}
                    title="Chat" 
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); handleOpenChat(call); }}
                >
                    <i className="bi bi-chat-left-text-fill"></i>
                </button>
                
                {canDelete && (
                    <button 
                        className="action-btn icon-btn-red" 
                        title="Delete" 
                        style={{ marginLeft: 'auto' }} 
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => { e.stopPropagation(); setDeleteTarget({ id: call.id, name: displayTitle, type: call.type }); }}
                    >
                        <i className="bi bi-trash"></i>
                    </button>
                )}
            </div>
        </div>
    );
};

function RecentCalls() {
    const { user } = useAuth();
    const navigate = useNavigate();

    const [searchTerm, setSearchTerm] = useState('');
    const [allCalls, setAllCalls] = useState([]);
    const [filteredCalls, setFilteredCalls] = useState([]);
    const [loading, setLoading] = useState(true);
    const [dailyCallCount, setDailyCallCount] = useState(0);
    const dailyCallLimit = 32;

    const [isCalling, setIsCalling] = useState(null);
    const [deleteTarget, setDeleteTarget] = useState(null);
    
    const [showNotificationModal, setShowNotificationModal] = useState(false);
    const [showAddContactModal, setShowAddContactModal] = useState(false);
    const [modalType, setModalType] = useState('individual');

    const [allNotifications, setAllNotifications] = useState([]);
    const [unreadCount, setUnreadCount] = useState(0);

    const [newContactName, setNewContactName] = useState('');
    const [newContactEmail, setNewContactEmail] = useState('');
    const [newContactDesc, setNewContactDesc] = useState('');
    const [groupEmails, setGroupEmails] = useState('');
    const [isCreating, setIsCreating] = useState(false);

    // --- DRAG AND DROP SENSORS ---
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
        useSensor(TouchSensor, {
            activationConstraint: {
                delay: 250,
                tolerance: 5,
            },
        }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );

    useEffect(() => {
        const enableAudio = () => initAudioContext();
        window.addEventListener('click', enableAudio, { once: true });
        return () => window.removeEventListener('click', enableAudio);
    }, []);

    const showCallToast = useCallback((notification) => {
        playNotificationSound();
        const toastId = toast(
            <CallNotification
                callerName={notification.callerName}
                callId={notification.callId}
                callType={notification.callType}
                onClose={() => toast.dismiss(toastId)}
                navigate={navigate}
            />,
            { autoClose: false, closeButton: false, position: "top-right", icon: "📞" }
        );
    }, [navigate]);

    const sendInvitationEmails = async (callId, callDescription, invitedEmailsArray) => {
        if (!invitedEmailsArray || invitedEmailsArray.length === 0) return;
        const emailjsPublicKey = 'Cd-NUUSJ5dW3GJMo0'; 
        const serviceID = 'service_y8qops6';
        const templateID = 'template_apzjekq';
        const callLink = `${window.location.origin}/call/${callId}`;

        for (const email of invitedEmailsArray) {
            try {
                await emailjs.send(serviceID, templateID, {
                    from_name: `${user.firstname} ${user.lastname}`,
                    to_email: email,
                    session_description: callDescription,
                    session_link: callLink,
                }, emailjsPublicKey);
            } catch (error) {
                console.error("Email error for " + email, error);
            }
        }
    };

    const handleCreateNewContact = async () => {
        if (!user) return toast.error("Login required");

        setIsCreating(true);
        const newCallId = Math.random().toString(36).substring(2, 9);
        const callDocRef = doc(db, 'calls', newCallId);

        let callData = {};
        let recipients = [];

        if (modalType === 'individual') {
            if (!newContactName.trim() || !newContactEmail.trim() || !newContactDesc.trim()) {
                setIsCreating(false);
                return toast.warn("Please fill all fields.");
            }
            const recipientEmail = newContactEmail.trim();
            recipients = [recipientEmail];
            
            callData = {
                type: 'individual',
                description: newContactDesc,
                createdAt: serverTimestamp(),
                ownerId: user._id,
                ownerName: `${user.firstname} ${user.lastname}`,
                ownerEmail: user.email,
                recipientName: newContactName.trim(),
                recipientEmail: recipientEmail,
                allowedEmails: [user.email, recipientEmail],
                access: 'private',
                muteStatus: { [user._id]: false },
            };

        } else {
            if (!newContactDesc.trim() || !groupEmails.trim()) {
                setIsCreating(false);
                return toast.warn("Description and emails required.");
            }
            const emailList = groupEmails.split(',').map(e => e.trim()).filter(e => e !== "");
            recipients = emailList;
            const allAllowed = [user.email, ...emailList];

            callData = {
                type: 'group',
                description: newContactDesc,
                createdAt: serverTimestamp(),
                ownerId: user._id,
                ownerName: `${user.firstname} ${user.lastname}`,
                ownerEmail: user.email,
                recipientName: newContactDesc,
                recipientEmail: 'Multiple',
                allowedEmails: allAllowed,
                access: 'private',
                muteStatus: { [user._id]: false },
            };
        }

        try {
            await setDoc(callDocRef, callData);

            if (modalType === 'group') {
                const groupChatRef = doc(db, 'group_chats', newCallId);
                await setDoc(groupChatRef, {
                    groupName: newContactDesc,
                    participants: [user.email, ...recipients],
                    createdAt: serverTimestamp(),
                    createdBy: user.email,
                    typing: {}
                });
            }

            toast.success(modalType === 'individual' ? "Contact saved!" : "Group created!");
            setShowAddContactModal(false);
            setNewContactName(''); setNewContactEmail(''); setNewContactDesc(''); setGroupEmails('');
        } catch (error) {
            console.error("Create error:", error);
            toast.error("Failed to create.");
        } finally {
            setIsCreating(false);
        }
    };

    const handleReCall = async (callData) => {
        if (!user) return toast.error("Login required");
        setIsCalling(callData.id);

        const today = new Date().toISOString().split('T')[0];
        const limitDocRef = doc(db, 'userCallLimits', user._id);
        
        try {
            await runTransaction(db, async (transaction) => {
                const limitDoc = await transaction.get(limitDocRef);
                let currentCount = (limitDoc.exists() && limitDoc.data().lastCallDate === today) ? limitDoc.data().count : 0;
                if (currentCount >= dailyCallLimit) throw new Error("Daily limit reached");
                transaction.set(limitDocRef, { count: currentCount + 1, lastCallDate: today });
            });

            const recipients = callData.allowedEmails.filter(e => e !== user.email);
            const batch = writeBatch(db);
            recipients.forEach(email => {
                const notifRef = doc(collection(db, 'notifications'));
                batch.set(notifRef, {
                    recipientEmail: email,
                    callerName: `${user.firstname} ${user.lastname}`,
                    callerEmail: user.email,
                    callId: callData.id,
                    callType: callData.type, // Added callType
                    createdAt: serverTimestamp(),
                    status: 'pending',
                    type: 'call'
                });
            });
            await batch.commit();

            await sendInvitationEmails(callData.id, callData.description, recipients);
            toast.success(`Starting call...`);
            navigate(`/call/${callData.id}`);
        } catch (error) {
            toast.error(error.message);
        } finally {
            setIsCalling(null);
        }
    };

    const confirmDelete = async () => {
        if (!deleteTarget) return;
        try {
            await deleteDoc(doc(db, 'calls', deleteTarget.id));
            toast.success("Deleted");
        } catch (e) { toast.error("Delete failed"); }
        setDeleteTarget(null);
    };

    const openNotificationModal = async () => {
        setShowNotificationModal(true);
        const q = query(collection(db, 'notifications'), where('recipientEmail', '==', user.email), orderBy('createdAt', 'desc'), limit(50));
        const snap = await getDocs(q);
        const notifs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setAllNotifications(notifs);

        const batch = writeBatch(db);
        let hasUnread = false;
        notifs.forEach(n => {
            if (n.status === 'unread' || n.status === 'pending') {
                batch.update(doc(db, 'notifications', n.id), { status: 'read' });
                hasUnread = true;
            }
        });
        if (hasUnread) await batch.commit();
    };

    const handleOpenChat = (call) => {
        if (!user) return;
        if (call.type === 'group') {
            navigate(`/chat/group_chats/${call.id}`, { state: { recipientName: call.description } });
        } else {
            const email = call.ownerId === user._id ? call.recipientEmail : call.ownerEmail;
            const name = call.ownerId === user._id ? call.recipientName : call.ownerName;
            const participants = [user.email, email].sort();
            navigate(`/chat/direct_chats/${participants.join('_')}`, { state: { recipientName: name } });
        }
    };

    const handleDragEnd = (event) => {
        const { active, over } = event;
        if (active.id !== over.id) {
            setFilteredCalls((items) => {
                const oldIndex = items.findIndex((item) => item.id === active.id);
                const newIndex = items.findIndex((item) => item.id === over.id);
                return arrayMove(items, oldIndex, newIndex);
            });
        }
    };

    // --- EFFECTS ---
    useEffect(() => {
        if (!user) return setLoading(false);
        const q = query(collection(db, 'calls'), where('allowedEmails', 'array-contains', user.email), orderBy('createdAt', 'desc'), limit(100));
        
        const unsub = onSnapshot(q, (snap) => {
            const rawCalls = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            
            // Deduplication Logic
            const uniqueCalls = [];
            const seenKeys = new Set();
            for (const call of rawCalls) {
                let uniqueKey = call.type === 'group' ? 'group_' + call.id : (call.ownerId === user._id ? 'user_' + call.recipientEmail : 'user_' + call.ownerEmail);
                if (!seenKeys.has(uniqueKey)) {
                    seenKeys.add(uniqueKey);
                    uniqueCalls.push(call);
                }
            }
            setAllCalls(uniqueCalls);
            setFilteredCalls(uniqueCalls);
            setLoading(false);
        });
        return () => unsub();
    }, [user]);

    useEffect(() => {
        if (!user) return;
        const today = new Date().toISOString().split('T')[0];
        const unsub = onSnapshot(doc(db, 'userCallLimits', user._id), (doc) => {
            const data = doc.data();
            setDailyCallCount((data && data.lastCallDate === today) ? data.count : 0);
        });
        return () => unsub();
    }, [user]);

    useEffect(() => {
        if (!searchTerm) {
            setFilteredCalls(allCalls);
        } else {
            const lower = searchTerm.toLowerCase();
            setFilteredCalls(allCalls.filter(c => {
                const name = c.type === 'group' ? c.description : (c.ownerId === user._id ? c.recipientName : c.ownerName);
                const email = c.type === 'group' ? 'group' : (c.ownerId === user._id ? c.recipientEmail : c.ownerEmail);
                return name?.toLowerCase().includes(lower) || email?.toLowerCase().includes(lower);
            }));
        }
    }, [searchTerm, allCalls, user]);

    useEffect(() => {
        if (!user) return;
        const q = query(collection(db, 'notifications'), where('recipientEmail', '==', user.email), where('status', '==', 'pending'));
        const unsub = onSnapshot(q, async (snap) => {
            if (snap.empty) return;
            if (snap.docs.some(d => d.data().type === 'call')) playNotificationSound();
            const batch = writeBatch(db);
            snap.docs.forEach(d => {
                const data = d.data();
                if (data.type === 'call') showCallToast(data);
                batch.update(d.ref, { status: 'unread' });
            });
            await batch.commit();
        });
        return () => unsub();
    }, [user, showCallToast]);

    useEffect(() => {
        if (!user) return;
        const q = query(collection(db, 'notifications'), where('recipientEmail', '==', user.email), where('status', '==', 'unread'));
        const unsub = onSnapshot(q, snap => setUnreadCount(snap.size));
        return () => unsub();
    }, [user]);

    const getAvatarColor = (name) => {
        const colors = ['#fd7e14', '#6f42c1', '#d63384', '#198754', '#0d6efd', '#dc3545', '#ffc107'];
        return colors[(name?.split('').reduce((a, c) => a + c.charCodeAt(0), 0) || 0) % colors.length];
    };

    if (loading) return <div className="p-5 text-center"><div className="spinner-border text-primary"></div></div>;

    return (
        <div className="recent-calls-container">
            <style jsx>{`
                /* --- BASE LAYOUT --- */
                .recent-calls-container { 
                    background-color: #111b21; 
                    height: calc(100vh - 60px); 
                    width: 100%; 
                    margin: 0;
                    display: flex; flex-direction: column; color: #e9edef; font-family: sans-serif;
                    box-sizing: border-box; overflow-x: hidden;
                    touch-action: pan-y;
                }
                .sticky-header { 
                    position: sticky; top: 0; z-index: 100; background-color: #111b21; padding: 20px 20px 10px; border-bottom: 1px solid rgba(134, 150, 160, 0.15);
                    box-sizing: border-box; width: 100%;
                }
                .header-actions { display: flex; gap: 15px; align-items: center; margin-bottom: 15px; flex-wrap: wrap; }
                .search-wrapper { flex-grow: 1; min-width: 200px; }
                .search-input-group { 
                    background-color: #202c33; border-radius: 24px; display: flex; align-items: center; 
                    padding: 0 20px; height: 46px; border: 1px solid transparent; transition: 0.2s;
                    width: 100%; box-sizing: border-box;
                }
                .search-input-group:focus-within { background-color: #2a3942; border-color: rgba(255,255,255,0.1); }
                .search-input { background: transparent; border: none; color: #e9edef; width: 100%; margin-left: 10px; outline: none; font-size: 1rem; }
                
                .recent-calls-grid { 
                    flex: 1; overflow-y: auto; padding: 20px; display: grid; 
                    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 15px; align-content: start; 
                    width: 100%; box-sizing: border-box;
                    overscroll-behavior-y: contain; 
                    -webkit-overflow-scrolling: touch;
                }

                @media (max-width: 480px) {
                    .recent-calls-grid { grid-template-columns: 1fr; padding: 15px; } 
                    .header-actions { flex-direction: row !important; align-items: center; gap: 10px; }
                    .search-wrapper { width: auto; flex: 1; }
                    .search-input-group { height: 40px; }
                }

                /* --- HEADER BUTTONS (Still Glassy) --- */
                .glass-btn-green, .glass-btn-purple {
                    border: none; border-radius: 24px; padding: 10px 20px;
                    font-weight: 600; display: flex; align-items: center; gap: 8px; cursor: pointer; transition: 0.3s;
                    box-shadow: 0 4px 6px rgba(0,0,0,0.2); white-space: nowrap;
                    backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
                }
                .glass-btn-green { background: linear-gradient(135deg, rgba(0, 168, 132, 0.7), rgba(0, 143, 111, 0.9)); border: 1px solid rgba(255, 255, 255, 0.2); color: white; }
                .glass-btn-green:hover { transform: translateY(-2px); box-shadow: 0 6px 12px rgba(0, 168, 132, 0.4); }
                .glass-btn-purple { background: linear-gradient(135deg, rgba(111, 66, 193, 0.7), rgba(89, 53, 154, 0.9)); border: 1px solid rgba(255, 255, 255, 0.2); color: white; }
                .glass-btn-purple:hover { transform: translateY(-2px); box-shadow: 0 6px 12px rgba(111, 66, 193, 0.4); }

                /* --- CARDS --- */
                .call-card { 
                    background: rgba(31, 41, 55, 0.7); 
                    backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
                    border: 1px solid rgba(255, 255, 255, 0.08);
                    box-shadow: 0 4px 30px rgba(0, 0, 0, 0.1);
                    border-radius: 16px; padding: 20px; 
                    display: flex; flex-direction: column; min-height: 220px; 
                    transition: 0.3s all ease; position: relative; overflow: hidden;
                }
                .call-card.joint-meet { 
                    background: linear-gradient(145deg, rgba(55, 65, 81, 0.7) 0%, rgba(17, 24, 39, 0.85) 100%);
                    border: 1px solid rgba(255, 255, 255, 0.15);
                    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
                }
                .call-card:hover { transform: translateY(-5px); border-color: rgba(255, 255, 255, 0.2); box-shadow: 0 12px 40px rgba(0, 0, 0, 0.3); }
                .call-card::before {
                    content: ''; position: absolute; top: 0; left: 0; right: 0; height: 100%;
                    background: linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0) 100%); pointer-events: none;
                }

                /* --- CARD ACTION BUTTONS (UPDATED: Flat/Normal Style) --- */
                .card-actions { display: flex; gap: 12px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.05); z-index: 10; position: relative; }
                .action-btn { 
                    width: 38px; height: 38px; border-radius: 50%; 
                    display: flex; align-items: center; justify-content: center;
                    border: 1px solid rgba(134, 150, 160, 0.15); /* Subtle generic border */
                    cursor: pointer; transition: 0.2s; font-size: 1.1rem; z-index: 20; 
                    /* No blur, solid dark background to match image */
                    background-color: #202c33; 
                }
                
                .icon-btn-green { color: #00a884; }
                .icon-btn-green:hover { background-color: rgba(0, 168, 132, 0.1); border-color: #00a884; }
                
                .icon-btn-purple { color: #b185f7; }
                .icon-btn-purple:hover { background-color: rgba(111, 66, 193, 0.1); border-color: #b185f7; }
                
                .icon-btn-red { color: #ef5350; }
                .icon-btn-red:hover { background-color: rgba(239, 83, 80, 0.1); border-color: #ef5350; }

                .card-header-icon { width: 44px; height: 44px; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 1.3rem; font-weight: bold; color: white; margin-bottom: 12px; z-index: 2; }
                .card-title { font-size: 1.1rem; font-weight: 600; color: #e9edef; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; z-index: 2; }
                .card-subtitle { font-size: 0.85rem; color: #8696a0; margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; z-index: 2; }
                .card-date { font-size: 0.75rem; color: #556066; margin-bottom: 12px; z-index: 2; }
                
                .badge { position: absolute; top: 15px; right: 15px; font-size: 0.65rem; padding: 4px 8px; border-radius: 12px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600; z-index: 2; }
                .badge-meeting { background: rgba(0, 168, 132, 0.2); color: #00a884; }
                .badge-joint { background: rgba(111, 66, 193, 0.2); color: #b185f7; }

                /* Modal */
                .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.8); z-index: 1000; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(4px); }
                .modal-card { background: #1f2937; color: #e9edef; width: 90%; max-width: 420px; padding: 24px; border-radius: 16px; border: 1px solid #374051; box-shadow: 0 20px 50px rgba(0,0,0,0.5); }
                .modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
                .modal-title { margin: 0; font-size: 1.25rem; font-weight: 600; }
                .close-btn { background: none; border: none; color: #8696a0; font-size: 1.2rem; cursor: pointer; }
                .form-group { margin-bottom: 15px; }
                .form-label { display: block; color: #8696a0; font-size: 0.85rem; margin-bottom: 6px; }
                .form-control { width: 100%; background: #2a3942; border: 1px solid #374051; color: white; padding: 10px 14px; border-radius: 8px; outline: none; transition: 0.2s; }
                .form-control:focus { border-color: #00a884; }
                .modal-footer { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }
                .btn-modal { padding: 10px 20px; border-radius: 8px; border: none; font-weight: 600; cursor: pointer; }
                .btn-primary { background: #00a884; color: white; }
                .btn-primary:hover { background: #008f6f; }
                .btn-secondary { background: transparent; border: 1px solid #374051; color: #8696a0; }
                .btn-secondary:hover { border-color: #8696a0; color: white; }
                .btn-danger { background: #ef5350; color: white; }

                .mobile-fab-container { display: none; }
                @media (max-width: 768px) {
                    /* Only hide header buttons, keep notification ones visible */
                    .header-actions .glass-btn-green, 
                    .header-actions .glass-btn-purple { 
                        display: none !important; 
                    }
                    
                    .mobile-fab-container { display: flex; align-items: center; position: relative; z-index: 200; }
                    .fab-trigger { width: 40px; height: 40px; border-radius: 50%; background-color: #00a884; color: white; border: none; font-size: 1.4rem; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 6px rgba(0,0,0,0.3); transition: transform 0.3s ease, background 0.3s; cursor: pointer; z-index: 202; }
                    .fab-options { position: absolute; left: 10px; top: 0; height: 40px; display: flex; align-items: center; gap: 8px; opacity: 0; visibility: hidden; transform: translateX(-10px) scale(0.9); transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275); z-index: 201; pointer-events: none; background: rgba(31, 41, 55, 0.9); padding: 5px 10px 5px 35px; border-radius: 24px; margin-left: -5px; }
                    .mobile-fab-container:hover .fab-options, .mobile-fab-container:active .fab-options { opacity: 1; visibility: visible; transform: translateX(10px) scale(1); pointer-events: auto; left: 100%; margin-left: -35px; }
                    .mobile-fab-container:hover .fab-trigger { transform: rotate(45deg); background-color: #202c33; }
                    .fab-mini-btn { border: none; border-radius: 20px; padding: 6px 12px; font-size: 0.75rem; font-weight: 600; color: white; display: flex; align-items: center; gap: 5px; cursor: pointer; white-space: nowrap; box-shadow: 0 2px 4px rgba(0,0,0,0.2); }
                    .fab-btn-new { background-color: #00a884; }
                    .fab-btn-joint { background-color: #6f42c1; }
                }
            `}</style>

            <div className="sticky-header">
                {/* Header content remains the same */}
                <div className="header-actions">
                    <button className="glass-btn-green" onClick={() => { setModalType('individual'); setShowAddContactModal(true); }}>
                        <i className="bi bi-person-plus-fill"></i> New Meeting
                    </button>

                    <button className="glass-btn-purple" onClick={() => { setModalType('group'); setShowAddContactModal(true); }}>
                        <i className="bi bi-people-fill"></i> Joint Meeting
                    </button>

                    <div className="mobile-fab-container">
                        <button className="fab-trigger"><i className="bi bi-plus-lg"></i></button>
                        <div className="fab-options">
                            <button className="fab-mini-btn fab-btn-new" onClick={() => { setModalType('individual'); setShowAddContactModal(true); }}>
                                <i className="bi bi-person-plus-fill"></i> New
                            </button>
                            <button className="fab-mini-btn fab-btn-joint" onClick={() => { setModalType('group'); setShowAddContactModal(true); }}>
                                <i className="bi bi-people-fill"></i> Joint
                            </button>
                        </div>
                    </div>

                    <div className="search-wrapper">
                        <div className="search-input-group">
                            <i className="bi bi-search" style={{ color: '#8696a0', marginRight: '10px' }}></i>
                            <input type="text" className="search-input" placeholder="Search" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
                        </div>
                    </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#8696a0', fontSize: '0.85rem', padding: '0 5px' }}>
                    <span>Conducted Meetings: {dailyCallCount}/{dailyCallLimit}</span>
                    <div style={{ cursor: 'pointer', position: 'relative' }} onClick={openNotificationModal}>
                        <i className="bi bi-bell-fill" style={{ fontSize: '1.2rem', color: unreadCount ? '#e9edef' : '#8696a0' }}></i>
                        {unreadCount > 0 && (
                            <span style={{ position: 'absolute', top: '-5px', right: '-5px', background: '#00a884', color: 'white', fontSize: '0.6rem', width: '16px', height: '16px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                {unreadCount}
                            </span>
                        )}
                    </div>
                </div>
            </div>

            <div className="recent-calls-grid">
                {!filteredCalls.length ? (
                    <div style={{ gridColumn: '1/-1', textAlign: 'center', color: '#8696a0', padding: '40px' }}>
                        {searchTerm ? 'No contacts match.' : 'No recent calls.'}
                    </div>
                ) : (
                    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                        <SortableContext items={filteredCalls} strategy={rectSortingStrategy}>
                            {filteredCalls.map(call => (
                                <SortableCallCard
                                    key={call.id}
                                    call={call}
                                    user={user}
                                    isCalling={isCalling}
                                    handleReCall={handleReCall}
                                    handleOpenChat={handleOpenChat}
                                    setDeleteTarget={setDeleteTarget}
                                    navigate={navigate}
                                    getAvatarColor={getAvatarColor}
                                />
                            ))}
                        </SortableContext>
                    </DndContext>
                )}
            </div>

            {/* Modals remain the same */}
            {showAddContactModal && (
                <div className="modal-overlay" onClick={() => setShowAddContactModal(false)}>
                    <div className="modal-card" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h5 className="modal-title">{modalType === 'group' ? 'Create Joint Meeting' : 'New Contact'}</h5>
                            <button className="close-btn" onClick={() => setShowAddContactModal(false)}><i className="bi bi-x-lg"></i></button>
                        </div>
                        <div className="modal-body">
                            {modalType === 'individual' ? (
                                <>
                                    <div className="form-group">
                                        <label className="form-label">Name</label>
                                        <input className="form-control" placeholder="Recipient Name" value={newContactName} onChange={e => setNewContactName(e.target.value)} />
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Email</label>
                                        <input className="form-control" placeholder="recipient@example.com" value={newContactEmail} onChange={e => setNewContactEmail(e.target.value)} />
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Description</label>
                                        <input className="form-control" placeholder="Project Sync..." value={newContactDesc} onChange={e => setNewContactDesc(e.target.value)} />
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div className="form-group">
                                        <label className="form-label">Meeting Description (Group Name)</label>
                                        <input className="form-control" placeholder="Q1 Planning..." value={newContactDesc} onChange={e => setNewContactDesc(e.target.value)} />
                                    </div>
                                    <div className="form-group">
                                        <label className="form-label">Participant Emails (Comma Separated)</label>
                                        <textarea className="form-control" rows="3" placeholder="alice@test.com, bob@test.com" value={groupEmails} onChange={e => setGroupEmails(e.target.value)} />
                                        <small style={{ color: '#8696a0', fontSize: '0.75rem' }}>Separate emails with commas.</small>
                                    </div>
                                </>
                            )}
                        </div>
                        <div className="modal-footer">
                            <button className="btn-modal btn-secondary" onClick={() => setShowAddContactModal(false)}>Cancel</button>
                            <button className="btn-modal btn-primary" disabled={isCreating} onClick={handleCreateNewContact}>
                                {isCreating ? 'Saving...' : 'Create'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {deleteTarget && (
                <div className="modal-overlay" onClick={() => setDeleteTarget(null)}>
                    <div className="modal-card" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h5 className="modal-title">Delete {deleteTarget.type === 'group' ? 'Group' : 'Contact'}</h5>
                            <button className="close-btn" onClick={() => setDeleteTarget(null)}><i className="bi bi-x-lg"></i></button>
                        </div>
                        <p style={{ color: '#8696a0', marginBottom: '20px' }}>Are you sure you want to delete <strong>{deleteTarget.name}</strong>?</p>
                        <div className="modal-footer">
                            <button className="btn-modal btn-secondary" onClick={() => setDeleteTarget(null)}>Cancel</button>
                            <button className="btn-modal btn-danger" onClick={confirmDelete}>Delete</button>
                        </div>
                    </div>
                </div>
            )}

            {showNotificationModal && (
                <div className="modal-overlay" onClick={() => setShowNotificationModal(false)}>
                    <div className="modal-card" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h5 className="modal-title">Notifications</h5>
                            <button className="close-btn" onClick={() => setShowNotificationModal(false)}><i className="bi bi-x-lg"></i></button>
                        </div>
                        <div style={{ maxHeight: '350px', overflowY: 'auto' }}>
                            {allNotifications.length === 0 ? (
                                <p style={{ textAlign: 'center', color: '#8696a0', padding: '20px' }}>No notifications</p>
                            ) : (
                                allNotifications.map(n => (
                                    <div key={n.id} style={{ padding: '12px', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                        <div>
                                            <div style={{ fontWeight: '600' }}>{n.callerName}</div>
                                            <div style={{ fontSize: '0.75rem', color: '#8696a0' }}>{formatTimeAgo(n.createdAt)}</div>
                                        </div>
                                        {n.type === 'call' && (
                                            <button 
                                                className={`btn-modal ${n.callType === 'group' ? 'glass-btn-purple' : 'glass-btn-green'}`} 
                                                style={{ padding: '6px 12px', fontSize: '0.85rem' }} 
                                                onClick={() => { navigate(`/call/${n.callId}`); setShowNotificationModal(false); }}
                                            >
                                                Join
                                            </button>
                                        )}
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
    
}

export default RecentCalls;