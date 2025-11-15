import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../firebaseConfig';
import { 
    collection, query, where, orderBy, limit, onSnapshot, 
    doc, setDoc, serverTimestamp, runTransaction, deleteDoc 
} from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { toast } from 'react-toastify';
import emailjs from '@emailjs/browser';

// Helper function to get today's date as YYYY-MM-DD
const getTodayString = () => {
    return new Date().toISOString().split('T')[0];
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

    // --- NEW: State to manage the delete confirmation modal ---
    const [deleteTarget, setDeleteTarget] = useState(null); // { id, name }

    // Function to send email when re-calling
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

    // "Speed dial" function with limit logic
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

            await sendInvitationEmails(newCallId, description, recipientEmail);
            toast.success(`Calling ${recipientName}...`);
            navigate(`/call/${newCallId}`);

        } catch (error) {
            console.error("Failed to create call:", error);
            toast.error(error.message || "Could not create the call.");
            setIsCalling(null);
        }
    };

    // --- MODIFIED ---: This function now *opens* the confirmation modal
    const promptForDelete = (callId, displayName) => {
        setDeleteTarget({ id: callId, name: displayName });
    };

    // --- NEW ---: This function runs the actual deletion
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
            setIsDeleting(null); // Reset deleting state
            setDeleteTarget(null); // Close the modal
        }
    };


    // Effect 1: Fetch all calls from Firebase
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
        // onSnapshot listens for real-time changes (including deletions)
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

    // Effect 2: Fetch and listen to the daily call count
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

    // Effect 3: Filter calls when searchTerm changes
    useEffect(() => {
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


    const formatTimestamp = (timestamp) => {
        if (!timestamp) return 'No date';
        return timestamp.toDate().toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });
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
            {/* --- NEW: Global styles for parent search bar --- */}
            <style jsx global>{`
                /* Target the search input in the parent */
                .form-control[placeholder="Search recent calls..."] {
                    height: 48px;
                    /* --- FIX: Correct border radius --- */
                    border-radius: 0 12px 12px 0 !important; 
                    padding-left: 2.5rem !important;
                    font-size: 0.95rem;
                }
                /* Target the search icon inside */
                .input-group-text {
                    border-radius: 12px 0 0 12px !important;
                    height: 48px;
                }
                /* Target the add button */
                .btn-primary.btn-sm { /* --- MODIFIED: Target .btn-sm --- */
                    background-color: #4A69BD; /* Professional blue */
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
            `}</style>
            
            {/* --- MODIFIED: Component-specific styles --- */}
            <style jsx>{`
            
                .recent-calls-list {
                    max-height: 60vh;
                    overflow-y: auto;
                    /* --- MODIFIED: Add padding --- */
                    padding: 0 1.25rem 1.25rem 1.25rem;
                }
                .call-item {
                    display: flex;
                    align-items: center;
                    padding: 1rem 1.25rem;
                    /* --- MODIFIED: Border instead of border-bottom --- */
                    border: 1px solid var(--bs-border-color); 
                    transition: background-color 0.2s ease;
                    border-radius: 12px; /* --- NEW --- */
                    margin-bottom: 0.5rem; /* --- NEW --- */
                }
                .call-item:last-child {
                     /* --- MODIFIED --- */
                    border-bottom: 1px solid var(--bs-border-color);
                    margin-bottom: 0;
                }
                .call-item:hover {
                    background-color: var(--bs-tertiary-bg);
                }
                .call-avatar {
                    width: 40px;
                    height: 40px;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-weight: 600;
                    color: white;
                    font-size: 1.2rem;
                    flex-shrink: 0;
                }
                .call-info {
                    margin-left: 1rem;
                    flex-grow: 1;
                    min-width: 0;
                }
                .call-name {
                    font-weight: 600;
                    font-size: 1rem;
                    color: var(--bs-body-color);
                    margin-bottom: 0.1rem;
                }
                
                /* --- MODIFIED: Call Details (for responsive time) --- */
                .call-details {
                    font-size: 0.85rem;
                    color: var(--bs-secondary-color);
                    display: flex;
                    flex-wrap: wrap; /* Allow wrapping */
                    align-items: center;
                }
                .call-email {
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    max-width: 100%;
                }
                .call-time {
                    white-space: nowrap;
                }
                .call-time-separator {
                    margin: 0 0.35rem;
                }

                .call-action {
                    margin-left: 1rem;
                    flex-shrink: 0;
                    display: flex;
                    align-items: center;
                    gap: 0.4rem; 
                }

                .call-button {
                    background: none;
                    border: none;
                    font-size: 1.4rem; 
                    padding: 0.5rem;
                    border-radius: 50%;
                    width: 44px;
                    height: 44px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: all 0.2s ease;
                    flex-shrink: 0; 
                }
                .call-button:disabled {
                    color: var(--bs-secondary-color) !important; /* !important to override */
                    background-color: transparent !important;
                    cursor: not-allowed;
                }
                
                /* --- NEW: Rejoin Button Style --- */
                .call-button-rejoin {
                    color: var(--bs-primary);
                }
                .call-button-rejoin:hover {
                    background-color: var(--bs-primary-bg-subtle);
                    color: var(--bs-primary-text-emphasis);
                }
                
                /* --- NEW: Call Button Style --- */
                .call-button-call {
                    color: var(--bs-success);
                }
                .call-button-call:hover {
                    background-color: var(--bs-success-bg-subtle);
                    color: var(--bs-success-text-emphasis);
                }

                /* --- MODIFIED: Delete button color --- */
                .call-delete-button {
                    color: #8a9199; /* Neutral gray */
                }
                .call-delete-button:hover {
                    background-color: var(--bs-danger-bg-subtle);
                    color: var(--bs-danger-text-emphasis); /* Red on hover */
                }


                .empty-state {
                    padding: 2rem;
                    text-align: center;
                    color: var(--bs-secondary-color);
                }
                
                /* --- MODIFIED: "Today's Calls" UI (now a badge) --- */
                .call-count-display {
                    padding: 0.6rem 1rem;
                    background-color: var(--bs-tertiary-bg);
                    border-radius: 10px;
                    font-size: 0.9rem;
                    color: var(--bs-secondary-color);
                    font-weight: 500;
                    /* --- FIX: Use margin to create the inset badge look --- */
                    margin: 0.5rem 1.25rem 1rem 1.25rem; 
                    text-align: left;
                }
                .call-count-display strong {
                    color: var(--bs-body-color);
                    font-weight: 600;
                }

                /* --- MODIFIED: Media query for responsive time --- */
                @media (max-width: 576px) {
                    .call-details {
                        flex-direction: column;
                        align-items: flex-start;
                        gap: 0.1rem;
                    }
                    .call-time-separator {
                        display: none;
                    }
                    .call-time {
                        font-size: 0.75rem;
                        /* Align with text, not icon */
                        padding-left: 26px; /* Approx width of icon + margin */
                    }
                    .call-item {
                        padding: 1rem 0.75rem;
                    }
                    /* --- MODIFIED: Adjust badge margin on mobile --- */
                    .call-count-display {
                        margin: 0.5rem 0.75rem 1rem 0.75rem;
                    }
                    .recent-calls-list {
                        padding: 0 0.75rem 0.75rem 0.75rem;
                    }
                }

                /* --- NEW: Delete Modal Styles --- */
                .delete-modal-overlay {
                    position: absolute; /* Changed from fixed to cover parent card */
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: rgba(0, 0, 0, 0.6);
                    backdrop-filter: blur(5px);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 100;
                    border-radius: 0.5rem; /* Match parent card border */
                }
                .delete-modal-card {
                    background: var(--bs-body-bg);
                    border-radius: 12px;
                    padding: 1.5rem;
                    width: 90%;
                    max-width: 400px;
                    box-shadow: 0 5px 20px rgba(0,0,0,0.2);
                }
                .delete-modal-title {
                    font-weight: 600;
                    font-size: 1.25rem;
                    color: var(--bs-body-color);
                    margin-bottom: 0.5rem;
                }
                .delete-modal-body {
                    color: var(--bs-secondary-color);
                    margin-bottom: 1.5rem;
                }
                .delete-modal-body strong {
                    color: var(--bs-body-color);
                }
                .delete-modal-actions {
                    display: flex;
                    gap: 0.75rem;
                    justify-content: flex-end;
                }
            `}</style>
            
            {/* --- NEW: Delete Confirmation Modal --- */}
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

            <div className="call-count-display">
                Today's Calls: <strong>{dailyCallCount} / {dailyCallLimit}</strong>
            </div>

            <div className="recent-calls-list">
                {filteredCalls.length === 0 ? (
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
                                    {/* --- MODIFIED: JSX for responsive time --- */}
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
                                    {/* --- MODIFIED: 1. Re-join button --- */}
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

                                    {/* --- MODIFIED: onClick now opens modal --- */}
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