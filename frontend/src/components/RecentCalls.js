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
const CallNotification = ({ callerName, callId, onClose, navigate }) => {
    const handleJoin = () => {
        navigate(`/call/${callId}`);
        onClose();
    };

    return (
        <div className="d-flex flex-column">
            <strong className="mb-1">{callerName} is calling!</strong>
            <div className="d-flex justify-content-end gap-2 mt-2">
                <button className="btn btn-sm btn-secondary" onClick={onClose} style={{fontSize: '0.8rem'}}>Dismiss</button>
                <button className="btn btn-sm btn-success" onClick={handleJoin} style={{fontSize: '0.8rem'}}>Join</button>
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
    
    // Actions State
    const [isCalling, setIsCalling] = useState(null);
    const [deleteTarget, setDeleteTarget] = useState(null);
    
    // Modal States
    const [showNotificationModal, setShowNotificationModal] = useState(false);
    const [showAddContactModal, setShowAddContactModal] = useState(false);
    
    // Notifications Data
    const [allNotifications, setAllNotifications] = useState([]);
    const [unreadCount, setUnreadCount] = useState(0);

    // New Contact Form State
    const [newContactName, setNewContactName] = useState('');
    const [newContactEmail, setNewContactEmail] = useState('');
    const [newContactDesc, setNewContactDesc] = useState('');
    const [isCreating, setIsCreating] = useState(false);

    // --- INIT ---
    useEffect(() => {
        const enableAudio = () => initAudioContext();
        window.addEventListener('click', enableAudio, { once: true });
        return () => window.removeEventListener('click', enableAudio);
    }, []);

    // --- TOAST HANDLER ---
    const showCallToast = useCallback((notification) => {
        playNotificationSound(); 
        const toastId = toast(
            <CallNotification
                callerName={notification.callerName}
                callId={notification.callId}
                onClose={() => toast.dismiss(toastId)}
                navigate={navigate}
            />,
            { autoClose: false, closeButton: false, position: "top-right", icon: "📞" }
        );
    }, [navigate]);

    // --- EMAIL HANDLER ---
    const sendInvitationEmails = async (callId, callDescription, invitedEmail) => {
        if (!invitedEmail) return;
        const emailjsPublicKey = 'Cd-NUUSJ5dW3GJMo0';
        const serviceID = 'service_y8qops6';
        const templateID = 'template_apzjekq';
        const callLink = `${window.location.origin}/call/${callId}`;
        try {
            await emailjs.send(serviceID, templateID, {
                from_name: `${user.firstname} ${user.lastname}`,
                to_email: invitedEmail,
                session_description: callDescription,
                session_link: callLink,
            }, emailjsPublicKey);
        } catch (error) {
            console.error("Email error", error);
        }
    };

    // --- CREATE NEW CONTACT LOGIC (Modal) ---
    const handleCreateNewContact = async () => {
        if (!user) return toast.error("Login required");
        if (!newContactName.trim() || !newContactEmail.trim() || !newContactDesc.trim()) {
            return toast.warn("Please fill all fields.");
        }

        setIsCreating(true);
        const newCallId = Math.random().toString(36).substring(2, 9);
        const callDocRef = doc(db, 'calls', newCallId);
        const recipientEmail = newContactEmail.trim();

        try {
            await setDoc(callDocRef, {
                description: newContactDesc,
                createdAt: serverTimestamp(),
                ownerId: user._id,
                ownerName: `${user.firstname} ${user.lastname}`,
                ownerEmail: user.email, 
                recipientName: newContactName.trim(),
                recipientEmail: recipientEmail, 
                access: 'private',
                defaultRole: 'editor',
                allowedEmails: [user.email, recipientEmail],
                permissions: { [user._id]: 'editor' },
                muteStatus: { [user._id]: false },
            });

            toast.success("Contact added!");
            setShowAddContactModal(false);
            setNewContactName('');
            setNewContactEmail('');
            setNewContactDesc('');
        } catch (error) {
            console.error("Create error:", error);
            toast.error("Failed to add contact");
        } finally {
            setIsCreating(false);
        }
    };

    // --- MAKE CALL LOGIC (Existing Contact) ---
    const handleReCall = async (callId, recipientName, recipientEmail, description) => {
        if (!user) return toast.error("Login required");
        setIsCalling(callId);
        
        const today = new Date().toISOString().split('T')[0];
        const limitDocRef = doc(db, 'userCallLimits', user._id);
        const newCallId = Math.random().toString(36).substring(2, 9);
        const callDocRef = doc(db, 'calls', newCallId);

        try {
            await runTransaction(db, async (transaction) => {
                const limitDoc = await transaction.get(limitDocRef);
                let currentCount = (limitDoc.exists() && limitDoc.data().lastCallDate === today) ? limitDoc.data().count : 0;
                if (currentCount >= dailyCallLimit) throw new Error("Daily limit reached");
                
                transaction.set(callDocRef, {
                    description, createdAt: serverTimestamp(), ownerId: user._id,
                    ownerName: `${user.firstname} ${user.lastname}`, ownerEmail: user.email,
                    recipientName, recipientEmail, access: 'private', defaultRole: 'editor',
                    allowedEmails: [user.email, recipientEmail], permissions: { [user._id]: 'editor' },
                    muteStatus: { [user._id]: false },
                });
                transaction.set(limitDocRef, { count: currentCount + 1, lastCallDate: today });
            });

            await addDoc(collection(db, 'notifications'), {
                recipientEmail, 
                callerName: `${user.firstname} ${user.lastname}`,
                callerEmail: user.email, 
                callId: newCallId, 
                createdAt: serverTimestamp(),
                status: 'pending', 
                type: 'call'
            });

            await sendInvitationEmails(newCallId, description, recipientEmail);
            toast.success(`Calling ${recipientName}...`);
            navigate(`/call/${newCallId}`);
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
            toast.success("Contact deleted");
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

    const handleOpenChat = (name, email) => {
        if (!user || !email) return;
        const participants = [user.email, email].sort();
        navigate(`/chat/direct_chats/${participants.join('_')}`, { state: { recipientName: name } });
    };

    // --- EFFECTS (Data Fetching) ---
    useEffect(() => {
        if (!user) return setLoading(false);
        const q = query(collection(db, 'calls'), where('allowedEmails', 'array-contains', user.email), orderBy('createdAt', 'desc'), limit(20));
        const unsub = onSnapshot(q, (snap) => {
            const calls = [];
            const seen = new Set();
            snap.docs.forEach(doc => {
                const data = { id: doc.id, ...doc.data() };
                const email = data.ownerId === user._id ? data.recipientEmail : data.ownerEmail;
                if (email && !seen.has(email)) { seen.add(email); calls.push(data); }
            });
            setAllCalls(calls);
            setFilteredCalls(calls);
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
                const name = c.ownerId === user._id ? c.recipientName : c.ownerName;
                const email = c.ownerId === user._id ? c.recipientEmail : c.ownerEmail;
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
        <>
        <div className="recent-calls-container">
            <style jsx>{`
                .recent-calls-container { background-color: #111b21; height: 100%; display: flex; flex-direction: column; color: #e9edef; font-family: sans-serif; }
                .sticky-header { position: sticky; top: 0; z-index: 100; background-color: #111b21; padding: 20px 20px 10px; border-bottom: 1px solid rgba(134, 150, 160, 0.15); }
                
                /* Header Actions (Google Meet Style) */
                .header-actions { display: flex; gap: 15px; align-items: center; margin-bottom: 15px; flex-wrap: wrap; }
                
                .new-call-btn {
                    background-color: #00a884;
                    color: white;
                    border: none;
                    border-radius: 24px; /* Pill shape */
                    padding: 10px 20px;
                    font-weight: 600;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    cursor: pointer;
                    transition: 0.2s;
                    box-shadow: 0 4px 6px rgba(0,0,0,0.2);
                    white-space: nowrap;
                }
                .new-call-btn:hover { background-color: #008f6f; transform: translateY(-1px); }

                .search-wrapper { flex-grow: 1; min-width: 200px; }
                .search-input-group { 
                    background-color: #202c33; 
                    border-radius: 24px; /* Pill shape */
                    display: flex; 
                    align-items: center; 
                    padding: 0 20px; 
                    height: 46px; 
                    border: 1px solid transparent; 
                    transition: 0.2s;
                }
                .search-input-group:focus-within { background-color: #2a3942; border-color: rgba(255,255,255,0.1); box-shadow: 0 1px 3px rgba(0,0,0,0.3); }
                .search-input { background: transparent; border: none; color: #e9edef; width: 100%; margin-left: 10px; outline: none; font-size: 1rem; }
                
                /* Grid (Fixed for Mobile Overflow) */
                .recent-calls-grid { 
                    flex: 1; 
                    overflow-y: auto; 
                    padding: 20px; 
                    display: grid; 
                    /* Use minmax(260px, 1fr) for better mobile fit */
                    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); 
                    gap: 15px; 
                    align-content: start; 
                }

                @media (max-width: 480px) {
                    .recent-calls-grid { grid-template-columns: 1fr; padding: 15px; } /* Full width on small mobile */
                    .header-actions { flex-direction: column-reverse; align-items: stretch; }
                    .new-call-btn { justify-content: center; }
                }

                /* Cards */
                .call-card { 
                    background-color: #1f2937; 
                    border-radius: 16px; 
                    padding: 20px; 
                    display: flex; 
                    flex-direction: column; 
                    min-height: 210px; 
                    border: 1px solid rgba(134,150,160,0.15); 
                    transition: 0.3s; 
                    position: relative; 
                    /* Removed cursor pointer from main card since clicking it does nothing now */
                }
                .call-card:hover { border-color: #00a884; transform: translateY(-3px); box-shadow: 0 8px 20px rgba(0,0,0,0.3); }
                
                .card-header-icon { width: 44px; height: 44px; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 1.3rem; font-weight: bold; color: white; margin-bottom: 12px; }
                .card-title { font-size: 1.1rem; font-weight: 600; color: #e9edef; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                .card-subtitle { font-size: 0.85rem; color: #8696a0; margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                .card-date { font-size: 0.75rem; color: #556066; margin-bottom: 12px; }
                
                .card-actions { display: flex; gap: 12px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.05); }
                .action-btn { background: transparent; border: none; color: #8696a0; font-size: 1.2rem; padding: 4px; cursor: pointer; transition: 0.2s; }
                .action-btn:hover { color: #e9edef; transform: scale(1.1); }
                .btn-call:hover { color: #00a884; } .btn-delete:hover { color: #ef5350; }

                /* Modal Common */
                .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.8); z-index: 1000; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(4px); }
                .modal-card { background: #1f2937; color: #e9edef; width: 90%; max-width: 420px; padding: 24px; border-radius: 16px; border: 1px solid #374051; box-shadow: 0 20px 50px rgba(0,0,0,0.5); }
                .modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
                .modal-title { margin: 0; font-size: 1.25rem; font-weight: 600; }
                .close-btn { background: none; border: none; color: #8696a0; font-size: 1.2rem; cursor: pointer; }
                
                /* Input Fields */
                .form-group { margin-bottom: 15px; }
                .form-label { display: block; color: #8696a0; font-size: 0.85rem; margin-bottom: 6px; }
                .form-control { width: 100%; background: #2a3942; border: 1px solid #374051; color: white; padding: 10px 14px; border-radius: 8px; outline: none; transition: 0.2s; }
                .form-control:focus { border-color: #00a884; }

                /* Buttons */
                .modal-footer { display: flex; justify-content: flex-end; gap: 10px; margin-top: 20px; }
                .btn-modal { padding: 10px 20px; border-radius: 8px; border: none; font-weight: 600; cursor: pointer; }
                .btn-primary { background: #00a884; color: white; }
                .btn-primary:hover { background: #008f6f; }
                .btn-secondary { background: transparent; border: 1px solid #374051; color: #8696a0; }
                .btn-secondary:hover { border-color: #8696a0; color: white; }
                .btn-danger { background: #ef5350; color: white; }
            `}</style>

            <div className="sticky-header">
                <div className="header-actions">
                    {/* New Call Button (Google Meet Style) */}
                  

                    {/* Search Bar (Google Meet Style) */}
                    <div className="search-wrapper">
                        <div className="search-input-group">
                            <i className="bi bi-search" style={{color: '#8696a0', marginRight: '10px'}}></i>
                            <input
                                type="text"
                                className="search-input"
                                placeholder="Search"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                    </div>
                </div>

                <div style={{display:'flex', justifyContent:'space-between', color:'#8696a0', fontSize:'0.85rem', padding:'0 5px'}}>
                    <span>Daily Limit: {dailyCallCount}/{dailyCallLimit}</span>
                    <div style={{cursor:'pointer', position: 'relative'}} onClick={openNotificationModal}>
                        <i className="bi bi-bell-fill" style={{fontSize: '1.2rem', color: unreadCount ? '#e9edef' : '#8696a0'}}></i>
                        {unreadCount > 0 && (
                            <span style={{
                                position: 'absolute', top: '-5px', right: '-5px', 
                                background: '#00a884', color: 'white', fontSize: '0.6rem', 
                                width: '16px', height: '16px', borderRadius: '50%', 
                                display: 'flex', alignItems: 'center', justifyContent: 'center'
                            }}>
                                {unreadCount}
                            </span>
                        )}
                    </div>
                </div>
            </div>

            <div className="recent-calls-grid">
                {!filteredCalls.length ? (
                    <div style={{gridColumn: '1/-1', textAlign:'center', color:'#8696a0', padding:'40px'}}>
                        {searchTerm ? 'No contacts match.' : 'No recent calls.'}
                    </div>
                ) : (
                    filteredCalls.map(call => {
                        const isOwner = call.ownerId === user._id;
                        const name = isOwner ? call.recipientName : call.ownerName;
                        const email = isOwner ? call.recipientEmail : call.ownerEmail;
                        if (!name) return null;
                        
                        return (
                            <div key={call.id} className="call-card">
                                <div className="card-header-icon" style={{ backgroundColor: getAvatarColor(name) }}>
                                    {name.charAt(0).toUpperCase()}
                                </div>
                                <div style={{flex: 1}}>
                                    <div className="card-title">{name}</div>
                                    <div className="card-subtitle">{email}</div>
                                    <div className="card-date">{formatTimeAgo(call.createdAt)}</div>
                                </div>
                                {/* Actions only trigger on button click */}
                                <div className="card-actions">
                                    <button className="action-btn btn-call" title="Video Call" disabled={isCalling === call.id} onClick={() => handleReCall(call.id, name, email, call.description)}>
                                        {isCalling === call.id ? <span className="spinner-border spinner-border-sm"></span> : <i className="bi bi-camera-video-fill"></i>}
                                    </button>
                                    <button className="action-btn" title="Chat" onClick={() => handleOpenChat(name, email)}>
                                        <i className="bi bi-chat-left-text-fill"></i>
                                    </button>
                                    <button className="action-btn btn-delete" title="Delete" style={{marginLeft:'auto'}} onClick={() => setDeleteTarget({id: call.id, name})}>
                                        <i className="bi bi-trash"></i>
                                    </button>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            {/* --- ADD CONTACT MODAL --- */}
            {showAddContactModal && (
                <div className="modal-overlay" onClick={() => setShowAddContactModal(false)}>
                    <div className="modal-card" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h5 className="modal-title">New Call</h5>
                            <button className="close-btn" onClick={() => setShowAddContactModal(false)}><i className="bi bi-x-lg"></i></button>
                        </div>
                        <div className="modal-body">
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
                        </div>
                        <div className="modal-footer">
                            <button className="btn-modal btn-secondary" onClick={() => setShowAddContactModal(false)}>Cancel</button>
                            <button className="btn-modal btn-primary" disabled={isCreating} onClick={handleCreateNewContact}>
                                {isCreating ? 'Saving...' : 'Add & Call'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* --- DELETE MODAL --- */}
            {deleteTarget && (
                <div className="modal-overlay" onClick={() => setDeleteTarget(null)}>
                    <div className="modal-card" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h5 className="modal-title">Delete Contact</h5>
                            <button className="close-btn" onClick={() => setDeleteTarget(null)}><i className="bi bi-x-lg"></i></button>
                        </div>
                        <p style={{color: '#8696a0', marginBottom: '20px'}}>Are you sure you want to delete <strong>{deleteTarget.name}</strong>?</p>
                        <div className="modal-footer">
                            <button className="btn-modal btn-secondary" onClick={() => setDeleteTarget(null)}>Cancel</button>
                            <button className="btn-modal btn-danger" onClick={confirmDelete}>Delete</button>
                        </div>
                    </div>
                </div>
            )}
            
            {/* --- NOTIFICATIONS MODAL --- */}
            {showNotificationModal && (
                <div className="modal-overlay" onClick={() => setShowNotificationModal(false)}>
                    <div className="modal-card" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h5 className="modal-title">Notifications</h5>
                            <button className="close-btn" onClick={() => setShowNotificationModal(false)}><i className="bi bi-x-lg"></i></button>
                        </div>
                        <div style={{maxHeight:'350px', overflowY:'auto'}}>
                            {allNotifications.length === 0 ? (
                                <p style={{textAlign:'center', color:'#8696a0', padding:'20px'}}>No notifications</p>
                            ) : (
                                allNotifications.map(n => (
                                    <div key={n.id} style={{padding:'12px', borderBottom:'1px solid rgba(255,255,255,0.05)', display:'flex', alignItems:'center', justifyContent:'space-between'}}>
                                        <div>
                                            <div style={{fontWeight:'600'}}>{n.callerName}</div>
                                            <div style={{fontSize:'0.75rem', color:'#8696a0'}}>{formatTimeAgo(n.createdAt)}</div>
                                        </div>
                                        {n.type === 'call' && (
                                            <button className="btn-modal btn-primary" style={{padding:'6px 12px', fontSize:'0.85rem'}} onClick={() => { navigate(`/call/${n.callId}`); setShowNotificationModal(false); }}>
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
         <div className="header-actions">
                    {/* New Call Button (Google Meet Style) */}
                    <button className="new-call-btn" onClick={() => setShowAddContactModal(true)}>
                        <i className="bi bi-plus-lg"></i>
                        New Meeting
                    </button> 
                </div>
                </>
    );
}

export default RecentCalls;