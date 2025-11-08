// src/components/RecentCalls.js

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../firebaseConfig';
// Import runTransaction for safe counter updates
import { 
    collection, query, where, orderBy, limit, onSnapshot, 
    doc, setDoc, serverTimestamp, runTransaction 
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
    const [allCalls, setAllCalls] = useState([]); // Stores all calls from Firebase
    const [filteredCalls, setFilteredCalls] = useState([]); // Stores calls to display
    const [loading, setLoading] = useState(true);
    const [isCalling, setIsCalling] = useState(null);
    const [dailyCallCount, setDailyCallCount] = useState(0); // State for the call count
    const dailyCallLimit = 32; // Define the limit
    const navigate = useNavigate();

    // Function to send email when re-calling
    const sendInvitationEmails = async (callId, callDescription, invitedEmail) => {
        if (!invitedEmail) return;
        const emailjsPublicKey = '3WEPhBvkjCwXVYBJ-';
        const serviceID = 'service_6ar5bgj';
        const templateID = 'template_w4ydq8a';
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
        // Define a reference to the user's specific limit document
        const limitDocRef = doc(db, 'userCallLimits', user._id);
        const newCallId = Math.random().toString(36).substring(2, 9);
        const callDocRef = doc(db, 'calls', newCallId);

        try {
            // Use a transaction to safely read and update the count
            await runTransaction(db, async (transaction) => {
                const limitDoc = await transaction.get(limitDocRef);
                
                let currentCount = 0;
                
                if (limitDoc.exists()) {
                    const data = limitDoc.data();
                    // Check if the stored count is from today
                    if (data.lastCallDate === today) {
                        currentCount = data.count;
                    }
                    // If data.lastCallDate is not today, currentCount remains 0 (it resets)
                }

                // Check the limit
                if (currentCount >= dailyCallLimit) {
                    // This error will be caught by the outer catch block
                    throw new Error(`You have reached your daily limit of ${dailyCallLimit} calls.`);
                }

                const newCount = currentCount + 1;

                // 1. Create the new call document
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

                // 2. Update the limit document with the new count and today's date
                transaction.set(limitDocRef, { 
                    count: newCount, 
                    lastCallDate: today 
                });
            });

            // --- If transaction is successful ---
            await sendInvitationEmails(newCallId, description, recipientEmail);
            toast.success(`Calling ${recipientName}...`);
            navigate(`/call/${newCallId}`);

        } catch (error) {
            // This will catch the "limit reached" error too
            console.error("Failed to create call:", error);
            toast.error(error.message || "Could not create the call.");
            setIsCalling(null); // Reset spinner on failure
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
            limit(20) // Get more calls to make search useful
        );
        const unsubscribe = onSnapshot(callsQuery, (snapshot) => {
            const callsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

            // =================================================================
            // === DE-DUPLICATION LOGIC ===
            // =================================================================
            const uniqueCalls = [];
            const seenEmails = new Set();
            
            for (const call of callsData) {
                // Determine the *other* person's email
                const isOwner = call.ownerId === user._id;
                const otherPersonEmail = isOwner ? call.recipientEmail : call.ownerEmail;

                // If we haven't seen this email yet, and it's valid, add it.
                if (otherPersonEmail && !seenEmails.has(otherPersonEmail)) {
                    seenEmails.add(otherPersonEmail);
                    uniqueCalls.push(call);
                }
            }
            // =================================================================

            setAllCalls(uniqueCalls); // Store the unique list
            setFilteredCalls(uniqueCalls); // Set the initial filtered list
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

        // Listen for real-time updates to the count
        const unsubscribe = onSnapshot(limitDocRef, (doc) => {
            if (doc.exists()) {
                const data = doc.data();
                // Only set the count if the date matches today
                if (data.lastCallDate === today) {
                    setDailyCallCount(data.count);
                } else {
                    // It's a new day, so the count is 0
                    setDailyCallCount(0);
                }
            } else {
                // No document exists, so the count is 0
                setDailyCallCount(0);
            }
        });

        return () => unsubscribe();
    }, [user]); // Re-run if the user logs in or out

    // Effect 3: Filter calls when searchTerm changes
    useEffect(() => {
        if (!searchTerm) {
            setFilteredCalls(allCalls); // If search is empty, show all calls
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
                call.id.toLowerCase().includes(lowerCaseSearch) // Also allow search by call ID
            );
        });
        setFilteredCalls(filtered);
    }, [searchTerm, allCalls, user]); // Re-run this filter when search or data changes


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
            <style jsx>{`
                .recent-calls-list {
                    /* Modified: Removed top border radius */
                    border-radius: 0 0 0.5rem 0.5rem;
                    overflow: hidden;
                    max-height: 60vh;
                    overflow-y: auto;
                }
                .call-item {
                    display: flex;
                    align-items: center;
                    padding: 1rem 1.25rem;
                    border-bottom: 1px solid var(--bs-border-color);
                    transition: background-color 0.2s ease;
                }
                .call-item:last-child {
                    border-bottom: none;
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
                .call-details {
                    font-size: 0.85rem;
                    color: var(--bs-secondary-color);
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }
                .call-action {
                    margin-left: 1rem;
                    flex-shrink: 0;
                    display: flex;
                    align-items: center;
                    gap: 0.5rem; /* Adds space between link and icon */
                }
                .call-rejoin-link {
                    font-family: "Courier New", Courier, monospace;
                    font-size: 0.9rem;
                    font-weight: 600;
                    color: var(--bs-primary);
                    text-decoration: none;
                    padding: 0.5rem;
                    border-radius: 0.3rem;
                    transition: background-color 0.2s ease, color 0.2s ease;
                }
                .call-rejoin-link:hover {
                    background-color: var(--bs-secondary-bg);
                    text-decoration: underline;
                }
                .call-button {
                    background: none;
                    border: none;
                    color: var(--bs-primary);
                    font-size: 1.5rem;
                    padding: 0.5rem;
                    border-radius: 50%;
                    width: 44px;
                    height: 44px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: background-color 0.2s ease;
                    flex-shrink: 0; 
                }
                .call-button:hover {
                    background-color: var(--bs-secondary-bg);
                }
                .call-button:disabled {
                    color: var(--bs-secondary-color);
                    cursor: not-allowed;
                }
                .empty-state {
                    padding: 2rem;
                    text-align: center;
                    color: var(--bs-secondary-color);
                }
                /* Style for the call counter */
                .call-count-display {
                    padding: 0.75rem 1.25rem;
                    background-color: var(--bs-tertiary-bg);
                    border-bottom: 1px solid var(--bs-border-color);
                    text-align: center;
                    font-size: 0.9rem;
                    color: var(--bs-secondary-color);
                    border-radius: 0.5rem 0.5rem 0 0;
                }
                .call-count-display strong {
                    color: var(--bs-body-color);
                    font-weight: 600;
                }
            `}</style>
            
            {/* Added the call count display at the top */}
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
                        
                        if (!displayName) return null; // Don't render calls with missing data

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
                                        <i className="bi bi-envelope-fill me-2"></i>
                                        {displayEmail} • {formatTimestamp(call.createdAt)}
                                    </div>
                                </div>

                                <div className="call-action">
                                    {/* 1. The new re-join link */}
                                    <a
                                        href={`/call/${call.id}`}
                                        className="call-rejoin-link"
                                        title={`Re-join session ${call.id}`}
                                        onClick={(e) => {
                                            e.preventDefault();
                                            navigate(`/call/${call.id}`);
                                        }}
                                    >
                                        {call.id}
                                    </a>

                                    {/* 2. The original "new call" button */}
                                    <button 
                                        className="call-button" 
                                        title={`Call ${displayName} (New Session)`}
                                        onClick={() => handleReCall(call.id, displayName, displayEmail, call.description)}
                                        // Also disable if count is at limit
                                        disabled={isCalling === call.id || dailyCallCount >= dailyCallLimit}
                                    >
                                        {isCalling === call.id ? (
                                            <div className="spinner-border spinner-border-sm" role="status">
                                                <span className="visually-hidden">Calling...</span>
                                            </div>
                                        ) : (
                                            <i className="bi bi-telephone-fill"></i>
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