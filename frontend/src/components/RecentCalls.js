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

// --- Audio Context for Notification Sound ---
let audioContext = null;

const initAudioContext = () => {
    if (audioContext) return;
    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        if (audioContext.state === 'suspended') {
            audioContext.resume();
        }
    } catch (e) {
        console.error("Web Audio API not supported", e);
    }
};

const playNotificationSound = () => {
    if (!audioContext) return;
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
    } catch (e) { console.error(e); }
};

const getTodayString = () => new Date().toISOString().split('T')[0];

const CallNotification = ({ callerName, callId, onClose, navigate }) => {
    const handleJoin = () => {
        navigate(`/call/${callId}`);
        onClose();
    };
    return (
        <div className="call-notification-toast">
            <strong className="d-block mb-2">{callerName} is calling!</strong>
            <div className="d-flex justify-content-end gap-2">
                <button className="btn btn-sm btn-light" onClick={onClose}>Dismiss</button>
                <button className="btn btn-sm btn-success" onClick={handleJoin}>Join</button>
            </div>
        </div>
    );
};

// --- MAIN COMPONENT ---
// Accepts onAddContact prop from parent
function RecentCalls({ onAddContact }) {
    const { user } = useAuth();
    const navigate = useNavigate();
    
    // State moved here to fix "search not working"
    const [searchTerm, setSearchTerm] = useState(''); 
    const [allCalls, setAllCalls] = useState([]);
    const [filteredCalls, setFilteredCalls] = useState([]);
    const [loading, setLoading] = useState(true);
    const [dailyCallCount, setDailyCallCount] = useState(0);
    const dailyCallLimit = 32;
    
    // Actions state
    const [isCalling, setIsCalling] = useState(null);
    const [deleteTarget, setDeleteTarget] = useState(null);
    
    // Notifications state
    const [allNotifications, setAllNotifications] = useState([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [showNotificationModal, setShowNotificationModal] = useState(false);

    // Audio Init
    useEffect(() => {
        window.addEventListener('click', initAudioContext, { once: true });
        return () => window.removeEventListener('click', initAudioContext);
    }, []);

    // --- Toast Helper ---
    const showCallToast = useCallback((notification) => {
        playNotificationSound();
        const toastId = toast(
            <CallNotification
                callerName={notification.callerName}
                callId={notification.callId}
                onClose={() => toast.dismiss(toastId)}
                navigate={navigate}
            />,
            { autoClose: false, closeButton: false, position: "top-right" }
        );
    }, [navigate]);

    // Send Email
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
            console.error("Email failed", error);
        }
    };

    // Make Call
    const handleReCall = async (callId, recipientName, recipientEmail, description) => {
        if (!user) return toast.error("Login required");
        setIsCalling(callId);
        const today = getTodayString();
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
                recipientEmail, callerName: `${user.firstname} ${user.lastname}`,
                callerEmail: user.email, callId: newCallId, createdAt: serverTimestamp(),
                status: 'pending', type: 'call'
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
        notifs.filter(n => n.status === 'unread').forEach(n => batch.update(doc(db, 'notifications', n.id), { status: 'read' }));
        await batch.commit();
    };

    const handleOpenChat = (name, email) => {
        if (!user || !email) return;
        const participants = [user.email, email].sort();
        navigate(`/chat/direct_chats/${participants.join('_')}`, { state: { recipientName: name } });
    };

    // --- EFFECTS ---
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
            setFilteredCalls(calls); // Initial load
            setLoading(false);
        });
        return () => unsub();
    }, [user]);

    useEffect(() => {
        if (!user) return;
        const unsub = onSnapshot(doc(db, 'userCallLimits', user._id), (doc) => {
            const data = doc.data();
            setDailyCallCount((data && data.lastCallDate === getTodayString()) ? data.count : 0);
        });
        return () => unsub();
    }, [user]);

    // Search Logic
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
            const batch = writeBatch(db);
            snap.docs.forEach(d => {
                if (d.data().type === 'call') showCallToast(d.data());
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
                .recent-calls-container { background-color: #111b21; height: 100%; display: flex; flex-direction: column; color: #e9edef; font-family: sans-serif; }
                .sticky-header { position: sticky; top: 0; z-index: 100; background-color: #111b21; padding: 15px 20px 5px; border-bottom: 1px solid rgba(134, 150, 160, 0.15); }
                
                /* Search Bar with Add Button */
                .search-wrapper { display: flex; gap: 10px; margin-bottom: 10px; }
                .search-input-group { flex-grow: 1; background-color: #1f2937; border-radius: 8px; display: flex; align-items: center; padding: 0 15px; height: 40px; border: 1px solid transparent; }
                .search-input-group:focus-within { border-color: #00a884; }
                .search-input { background: transparent; border: none; color: #e9edef; width: 100%; margin-left: 10px; outline: none; }
                .add-btn { background-color: #00a884; border: none; border-radius: 8px; color: white; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: 0.2s; }
                .add-btn:hover { background-color: #008f6f; }

                .stats-row { display: flex; justify-content: space-between; padding: 5px 0; font-size: 0.85rem; color: #8696a0; }
                .recent-calls-grid { flex: 1; overflow-y: auto; padding: 20px; display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 20px; align-content: start; }
                
                /* Cards */
                .call-card { background-color: #1f2937; border-radius: 16px; padding: 20px; display: flex; flex-direction: column; min-height: 180px; border: 1px solid rgba(134,150,160,0.15); transition: 0.3s; cursor: pointer; position: relative; }
                .call-card:hover { border-color: #00a884; transform: translateY(-5px); box-shadow: 0 10px 25px -5px rgba(0,0,0,0.5); }
                .card-header-icon { width: 48px; height: 48px; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 1.5rem; font-weight: bold; color: white; margin-bottom: 15px; }
                .card-title { font-size: 1.1rem; font-weight: 700; color: #e9edef; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                .card-subtitle { font-size: 0.85rem; color: #8696a0; margin-bottom: 5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                .card-date { font-size: 0.75rem; color: #556066; margin-bottom: 15px; }
                
                .card-actions { display: flex; gap: 10px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.05); opacity: 0.7; transition: 0.2s; }
                .call-card:hover .card-actions { opacity: 1; }
                .action-btn { background: transparent; border: none; color: #8696a0; font-size: 1.1rem; padding: 5px; cursor: pointer; }
                .action-btn:hover { color: #e9edef; }
                .btn-call:hover { color: #00a884; } .btn-delete:hover { color: #ef5350; }

                /* Modals */
                .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.8); z-index: 1000; display: flex; align-items: center; justify-content: center; backdrop-filter: blur(2px); }
                .modal-card { background: #1f2937; color: #e9edef; width: 90%; max-width: 400px; padding: 25px; border-radius: 16px; border: 1px solid #374051; }
                .modal-btn { padding: 8px 16px; border-radius: 6px; border: none; margin-left: 10px; }
                .btn-cancel { background: transparent; border: 1px solid #00a884; color: #00a884; }
                .btn-danger { background: #ef5350; color: white; }
            `}</style>

            <div className="sticky-header">
                <div className="search-wrapper">
                    <div className="search-input-group">
                        <i className="bi bi-search" style={{color: '#8696a0'}}></i>
                        <input
                            type="text"
                            className="search-input"
                            placeholder="Search recent calls..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                    {/* Add Contact Button */}
                    <button className="add-btn" onClick={onAddContact} title="Add New Contact">
                        <i className="bi bi-person-plus-fill"></i>
                    </button>
                </div>
                <div className="stats-row">
                    <span>Daily Limit: {dailyCallCount}/{dailyCallLimit}</span>
                    <div style={{cursor:'pointer'}} onClick={openNotificationModal}>
                        <i className="bi bi-bell-fill"></i>
                        {unreadCount > 0 && <span style={{marginLeft: '5px', color: '#00a884'}}>●</span>}
                    </div>
                </div>
            </div>

            <div className="recent-calls-grid">
                {!filteredCalls.length ? (
                    <div style={{gridColumn: '1/-1', textAlign:'center', color:'#8696a0', padding:'40px'}}>
                        {searchTerm ? 'No contacts match your search.' : 'No recent contacts found.'}
                    </div>
                ) : (
                    filteredCalls.map(call => {
                        const isOwner = call.ownerId === user._id;
                        const name = isOwner ? call.recipientName : call.ownerName;
                        const email = isOwner ? call.recipientEmail : call.ownerEmail;
                        if (!name) return null;
                        
                        return (
                            <div key={call.id} className="call-card" onClick={() => navigate(`/call/${call.id}`)}>
                                <div className="card-header-icon" style={{ backgroundColor: getAvatarColor(name) }}>
                                    {name.charAt(0).toUpperCase()}
                                </div>
                                <div style={{flex: 1}}>
                                    <div className="card-title">{name}</div>
                                    <div className="card-subtitle">{email}</div>
                                    <div className="card-date">{call.createdAt?.toDate().toLocaleDateString() || 'No date'}</div>
                                </div>
                                <div className="card-actions" onClick={(e) => e.stopPropagation()}>
                                    <button className="action-btn btn-call" disabled={isCalling === call.id} onClick={() => handleReCall(call.id, name, email, call.description)}>
                                        {isCalling === call.id ? <span className="spinner-border spinner-border-sm"></span> : <i className="bi bi-camera-video-fill"></i>}
                                    </button>
                                    <button className="action-btn" onClick={() => handleOpenChat(name, email)}>
                                        <i className="bi bi-chat-left-text-fill"></i>
                                    </button>
                                    <button className="action-btn btn-delete" style={{marginLeft:'auto'}} onClick={() => setDeleteTarget({id: call.id, name})}>
                                        <i className="bi bi-trash"></i>
                                    </button>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            {/* Modals omitted for brevity - they are same as previous, just ensure they are rendered */}
            {deleteTarget && (
                <div className="modal-overlay" onClick={() => setDeleteTarget(null)}>
                    <div className="modal-card" onClick={e => e.stopPropagation()}>
                        <h5>Delete Contact?</h5>
                        <p>Are you sure you want to delete <strong>{deleteTarget.name}</strong>?</p>
                        <div className="d-flex justify-content-end">
                            <button className="modal-btn btn-cancel" onClick={() => setDeleteTarget(null)}>Cancel</button>
                            <button className="modal-btn btn-danger" onClick={confirmDelete}>Delete</button>
                        </div>
                    </div>
                </div>
            )}
            
            {showNotificationModal && (
                <div className="modal-overlay" onClick={() => setShowNotificationModal(false)}>
                    <div className="modal-card" onClick={e => e.stopPropagation()}>
                        <div className="d-flex justify-content-between mb-3">
                            <h5>Notifications</h5>
                            <button className="action-btn" onClick={() => setShowNotificationModal(false)}><i className="bi bi-x-lg"></i></button>
                        </div>
                        <div style={{maxHeight:'300px', overflowY:'auto'}}>
                            {allNotifications.map(n => (
                                <div key={n.id} className="p-2 border-bottom" style={{borderColor: 'rgba(255,255,255,0.1)'}}>
                                    <strong>{n.callerName}</strong>
                                    {n.type === 'call' && <button className="btn btn-sm btn-link" onClick={() => navigate(`/call/${n.callId}`)}>Join</button>}
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default RecentCalls;