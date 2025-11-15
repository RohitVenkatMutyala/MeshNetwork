import React, { useState, useEffect } from 'react';

// --- Firebase Imports ---
// We now import directly from the Firebase CDN modules
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { 
    getFirestore, collection, query, where, orderBy, limit, onSnapshot, 
    doc, setDoc, serverTimestamp, runTransaction, deleteDoc, 
    updateDoc, addDoc, getDoc 
} from 'firebase/firestore';

// --- Mocks for External Dependencies ---
// The preview environment can't resolve these, so we create mock versions.

// Mock react-toastify
const toast = (component, options) => {
    console.log('CUSTOM TOAST:', options);
    // Log the component's name if possible
    console.log('Rendering custom toast component:', component.props.callerName);
    return 'mock-toast-id-' + Math.random();
};
Object.assign(toast, {
    success: (msg, options) => console.log('TOAST SUCCESS:', msg, options),
    error: (msg, options) => console.error('TOAST ERROR:', msg, options),
    warn: (msg, options) => console.warn('TOAST WARN:', msg, options),
    info: (msg, options) => console.info('TOAST INFO:', msg, options),
    dismiss: (id) => console.log('Dismiss toast:', id),
});

// Mock @emailjs/browser
const emailjs = {
    send: (serviceID, templateID, templateParams, publicKey) => {
        console.log('Mock EmailJS Send:', { serviceID, templateID, templateParams, publicKey });
        return Promise.resolve({ status: 200, text: 'OK' });
    }
};

// Mock react-router-dom's navigate function
const navigate = (path) => {
    console.log(`Mock navigation to: ${path}`);
    // In a real app, this would change the URL.
    // We can show a simple alert for demonstration.
    // (Note: We avoid 'alert' as per instructions, logging is safer)
    toast.info(`Navigating to ${path}...`);
};

// --- Helper function ---
const getTodayString = () => {
    return new Date().toISOString().split('T')[0];
};

// --- CallNotification Component ---
// No changes, it already accepts props
const CallNotification = ({ callerName, callId, onClose, navigate }) => {
    
    const handleJoin = () => {
      navigate(`/call/${callId}`);
      onClose(); // This will be the toast.dismiss function
    };

    return (
      <div className="call-notification-toast">
        <strong className="d-block mb-2">{callerName} is calling!</strong>
        <p className="mb-3">Do you want to join the session?</p>
        <div className="d-flex justify-content-end gap-2">
            <button className="btn btn-sm btn-light" onClick={onClose}>
                Decline
            </button>
            <button className="btn btn-sm btn-success" onClick={handleJoin}>
                Join Call
            </button>
        </div>
      </div>
    );
};

// --- RecentCalls Component ---
// This is your component, refactored to accept dependencies as props.
function RecentCalls({ user, db, navigate, toast, emailjs, searchTerm }) {
    // Removed: const { user } = useAuth();
    // Removed: const navigate = useNavigate();
    // 'db' is now passed as a prop.

    const [allCalls, setAllCalls] = useState([]);
    const [filteredCalls, setFilteredCalls] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isCalling, setIsCalling] = useState(null);
    const [isDeleting, setIsDeleting] = useState(null); 
    const [dailyCallCount, setDailyCallCount] = useState(0);
    const dailyCallLimit = 32;

    const [deleteTarget, setDeleteTarget] = useState(null); 

    const [isOnline, setIsOnline] = useState(true); 
    const [isVisibilityLoading, setIsVisibilityLoading] = useState(true);
    const [showVisibilityModal, setShowVisibilityModal] = useState(false);
    
    // Function to send email when re-calling
    // Uses 'emailjs' prop
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
    // Uses 'db', 'toast', 'navigate', 'emailjs' props
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

            // Send in-app notification
            try {
                await addDoc(collection(db, 'notifications'), {
                    recipientEmail: recipientEmail,
                    callerName: `${user.firstname} ${user.lastname}`,
                    callerEmail: user.email,
                    callId: newCallId,
                    createdAt: serverTimestamp(),
                    status: 'pending'
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

    // Uses 'db' and 'toast' props
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

    // Uses 'user', 'db', 'toast' props
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

            await updateDoc(userSettingsRef, { 
                isOnline: newIsOnline 
            });

        } catch (error) {
            console.error("Error updating visibility:", error);
            toast.error("Could not update visibility status.");
            setIsOnline(!newIsOnline); 
        }
    };

    // Uses 'user' and 'db' props
    const handleCloseVisibilityModal = async () => {
        setShowVisibilityModal(false);
        if (!user || !db) return;
        
        try {
            const userSettingsRef = doc(db, 'users', user._id);
            await updateDoc(userSettingsRef, { 
                hasSeenVisibilityPrompt: true 
            });
        } catch (error) {
            console.error("Error marking visibility prompt as seen:", error);
        }
    };


    // Effect 1: Fetch all calls from Firebase
    // Uses 'user' and 'db' props
    useEffect(() => {
        if (!user || !db) {
            setLoading(false);
            return;
        }
        setLoading(true);
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
    }, [user, db]);

    // Effect 2: Fetch and listen to the daily call count
    // Uses 'user' and 'db' props
    useEffect(() => {
        if (!user || !db) {
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
    }, [user, db]);

    // Effect 3: Filter calls when searchTerm changes
    // Uses 'user' prop
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

    // Effect 4: Listen for user's visibility status
    // Uses 'user' and 'db' props
    useEffect(() => {
        if (!user || !db) return;

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
    }, [user, db]);

    // Effect 5: Listen for incoming call notifications
    // Uses 'user', 'db', 'navigate', 'toast' props
    useEffect(() => {
        if (!user || !db) return;

        const notificationsQuery = query(
            collection(db, 'notifications'),
            where('recipientEmail', '==', user.email),
            where('status', '==', 'pending'),
            orderBy('createdAt', 'desc')
        );

        const unsubscribe = onSnapshot(notificationsQuery, async (snapshot) => {
            for (const docSnap of snapshot.docs) {
                const notification = docSnap.data();
                const notificationId = docSnap.id;
                
                const dismissToast = (id) => toast.dismiss(id);

                const toastId = toast(
                    <CallNotification
                        callerName={notification.callerName}
                        callId={notification.callId}
                        onClose={() => dismissToast(toastId)} // Pass dismiss function
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

                try {
                    await deleteDoc(doc(db, 'notifications', notificationId));
                } catch (err) {
                    console.error("Error deleting notification: ", err);
                }
            }
        });

        return () => unsubscribe();
    }, [user, db, navigate, toast]); // Added toast


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

    // --- JSX FOR RECENTCALLS ---
    // (This is the same as your code, no changes needed)
    return (
        <>
            {/* --- Visibility Confirmation Modal --- */}
            {showVisibilityModal && (
                <div className="delete-modal-overlay" onClick={handleCloseVisibilityModal}>
                    <div className="delete-modal-card" onClick={(e) => e.stopPropagation()}>
                        <h5 className="delete-modal-title">Profile Visibility</h5>
                        <p className="visibility-modal-body">
                            By enabling "Profile Visibility," you are allowing other users
                            on the app to see that you are online and available.
                            <br/><br/>
                            Your profile (name and email) may appear in their
                            "Online Users" list, making it easier to start a call.
                            You can turn this off at any time.
                        </p>
                        <div className="delete-modal-actions">
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

// --- Main App Component ---
// This component initializes Firebase and handles auth state,
// passing the required info down to RecentCalls.
export default function App() {
    const [user, setUser] = useState(null); // The combined user object { _id, email, firstname, ... }
    const [db, setDb] = useState(null);
    const [auth, setAuth] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);

    // Effect 1: Initialize Firebase and Auth
    useEffect(() => {
        try {
            // Get config from global variables provided by the environment
            const firebaseConfigStr = typeof __firebase_config !== 'undefined' ? __firebase_config : '{}';
            const authToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;
            
            if (firebaseConfigStr === '{}') {
                throw new Error("Firebase config is missing!");
            }

            const firebaseConfig = JSON.parse(firebaseConfigStr);
            const app = initializeApp(firebaseConfig);
            const authInstance = getAuth(app);
            const dbInstance = getFirestore(app);
            
            setDb(dbInstance);
            setAuth(authInstance);

            // Effect 2: Auth listener
            const unsubscribe = onAuthStateChanged(authInstance, async (firebaseUser) => {
                if (firebaseUser) {
                    // User is signed in, fetch their profile from 'users' collection
                    const userDocRef = doc(dbInstance, 'users', firebaseUser.uid);
                    const userDoc = await getDoc(userDocRef);

                    if (userDoc.exists()) {
                        const profileData = userDoc.data();
                        setUser({
                            _id: firebaseUser.uid,
                            email: firebaseUser.email,
                            firstname: profileData.firstname || 'User',
                            lastname: profileData.lastname || '',
                        });
                    } else {
                        // Fallback if no profile doc in 'users'
                        console.warn("No 'users' doc found for user, using fallback data.");
                        setUser({
                            _id: firebaseUser.uid,
                            email: firebaseUser.email,
                            firstname: firebaseUser.displayName?.split(' ')[0] || 'User',
                            lastname: firebaseUser.displayName?.split(' ').slice(1).join(' ') || '',
                        });
                    }
                } else {
                    // User is signed out
                    setUser(null);
                }
                setIsLoading(false);
            });

            // Effect 3: Sign in
            (async () => {
                try {
                    if (authToken) {
                        await signInWithCustomToken(authInstance, authToken);
                    } else {
                        console.warn("No auth token, signing in anonymously.");
                        await signInAnonymously(authInstance);
                    }
                } catch (authError) {
                    console.error("Authentication error:", authError);
                    setError("Failed to authenticate. Please try again.");
                    setIsLoading(false);
                }
            })();

            return () => unsubscribe(); // Cleanup listener

        } catch (e) {
            console.error("Failed to initialize Firebase:", e);
            setError("Failed to load application. Invalid configuration.");
            setIsLoading(false);
        }
    }, []); // Run only once on mount

    if (isLoading) {
         return (
             <div className="d-flex justify-content-center align-items-center" style={{ height: '100vh', opacity: 0.7 }}>
                 <div className="spinner-border text-primary" role="status">
                     <span className="visually-hidden">Loading...</span>
                 </div>
             </div>
         );
    }
    
    if (error) {
        return (
            <div className="p-4 text-center text-danger">
                {error}
            </div>
        );
    }

    // Render the main UI
    // This includes the search bar that was part of the parent component
    return (
        <div className="container-fluid p-0">
            {/* --- Global and Component Styles --- */}
            {/* We inject all styles here */}
            <style jsx global>{`
                /* Bootstrap Icons */
                @import url("https://cdn.jsdelivr.net/npm/bootstrap-icons@1.10.5/font/bootstrap-icons.css");

                /* Global styles for search bar, from RecentCalls */
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
                }
            `}</style>
            
            <style jsx>{`
                /* All component-specific styles from RecentCalls */
                .recent-calls-list {
                    max-height: 60vh;
                    overflow-y: auto;
                    padding: 0 1.25rem 1.25rem 1.25rem;
                }
                .call-item {
                    display: flex; align-items: center;
                    padding: 1rem 1.25rem;
                    border: 1px solid var(--bs-border-color); 
                    transition: background-color 0.2s ease;
                    border-radius: 12px; 
                    margin-bottom: 0.5rem; 
                }
                .call-item:last-child {
                    border-bottom: 1px solid var(--bs-border-color);
                    margin-bottom: 0;
                }
                .call-item:hover { background-color: var(--bs-tertiary-bg); }
                .call-avatar {
                    width: 40px; height: 40px; border-radius: 50%;
                    display: flex; align-items: center; justify-content: center;
                    font-weight: 600; color: white; font-size: 1.2rem; flex-shrink: 0;
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
                    padding: 0.6rem 1rem;
                    background-color: var(--bs-tertiary-bg);
                    border-radius: 10px; font-size: 0.9rem;
                    color: var(--bs-secondary-color); font-weight: 500;
                    margin: 0 1.25rem 1rem 1.25rem; 
                    text-align: left;
                }
                .call-count-display strong {
                    color: var(--bs-body-color); font-weight: 600;
                }
                .delete-modal-overlay {
                    position: absolute; top: 0; left: 0; right: 0; bottom: 0;
                    background: rgba(0, 0, 0, 0.6);
                    backdrop-filter: blur(5px);
                    display: flex; align-items: center; justify-content: center;
                    z-index: 100; border-radius: 0.5rem;
                }
                .delete-modal-card {
                    background: var(--bs-body-bg); border-radius: 12px;
                    padding: 1.5rem; width: 90%; max-width: 400px;
                    box-shadow: 0 5px 20px rgba(0,0,0,0.2);
                }
                .delete-modal-title {
                    font-weight: 600; font-size: 1.25rem;
                    color: var(--bs-body-color); margin-bottom: 0.5rem;
                }
                .delete-modal-body {
                    color: var(--bs-secondary-color); margin-bottom: 1.5rem;
                }
                .delete-modal-body strong { color: var(--bs-body-color); }
                .delete-modal-actions {
                    display: flex; gap: 0.75rem; justify-content: flex-end;
                }
                .visibility-control {
                    display: flex; align-items: center; justify-content: space-between;
                    padding: 0.75rem 1rem;
                    margin: 0 1.25rem 1rem 1.25rem;
                    background-color: var(--bs-tertiary-bg);
                    border-radius: 10px; font-size: 0.9rem; font-weight: 500;
                }
                .visibility-label {
                    color: var(--bs-body-color); margin-bottom: 0;
                }
                .toggle-switch {
                    position: relative; display: inline-block;
                    width: 44px; height: 24px; flex-shrink: 0;
                }
                .toggle-switch input { opacity: 0; width: 0; height: 0; }
                .toggle-slider {
                    position: absolute; cursor: pointer;
                    top: 0; left: 0; right: 0; bottom: 0;
                    background-color: #ccc; transition: .4s;
                    border-radius: 24px;
                }
                .toggle-slider:before {
                    position: absolute; content: "";
                    height: 18px; width: 18px; left: 3px; bottom: 3px;
                    background-color: white; transition: .4s;
                    border-radius: 50%;
                }
                input:checked + .toggle-slider { background-color: var(--bs-success); }
                input:checked + .toggle-slider:before { transform: translateX(20px); }
                input:disabled + .toggle-slider {
                    background-color: #e9ecef; cursor: not-allowed;
                }
                .visibility-modal-body {
                    color: var(--bs-secondary-color); margin-bottom: 1.5rem;
                    font-size: 0.95rem; line-height: 1.6;
                }
                @media (max-width: 576px) {
                    .call-details {
                        flex-direction: column; align-items: flex-start; gap: 0.1rem;
                    }
                    .call-time-separator { display: none; }
                    .call-time { font-size: 0.75rem; padding-left: 26px; }
                    .call-item { padding: 1rem 0.75rem; }
                    .call-count-display { margin: 0 0.75rem 1rem 0.75rem; }
                    .recent-calls-list { padding: 0 0.75rem 0.75rem 0.75rem; }
                    .visibility-control {
                        flex-direction: column;
                        align-items: flex-start !important;
                        gap: 0.25rem;
                    }
                }
            `}</style>
            
            {/* Search bar and add button (from parent) */}
            <div className="p-3">
                <div className="input-group">
                     <span className="input-group-text">
                         <i className="bi bi-search"></i>
                     </span>
                     <input 
                         type="text" 
                         className="form-control" 
                         placeholder="Search recent calls..."
                         value={searchTerm}
                         onChange={(e) => setSearchTerm(e.target.value)}
                         aria-label="Search recent calls"
                     />
                     <button className="btn btn-primary btn-sm" aria-label="Add new call">
                        <i className="bi bi-plus-lg"></i>
                     </button>
                </div>
            </div>
            
            {/* Render RecentCalls only if user and db are ready */}
            {user && db ? (
                <RecentCalls 
                    user={user}
                    db={db}
                    navigate={navigate}
                    toast={toast}
                    emailjs={emailjs}
                    searchTerm={searchTerm}
                />
            ) : (
                <div className="text-center p-5">
                    <p className="text-muted">No user signed in.</p>
                </div>
            )}
        </div>
    );
}