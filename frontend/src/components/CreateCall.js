import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebaseConfig';
import { useAuth } from '../context/AuthContext';
import { toast } from 'react-toastify';
import RecentCalls from './RecentCalls';
import Navbar from './navbar';

function CreateCall() {
    const { user } = useAuth();
    const [step, setStep] = useState(0); // 0 = Main list, 1 = Description, 2 = Invite
    const [description, setDescription] = useState('');
    const [recipientName, setRecipientName] = useState('');
    const [recipientEmail, setRecipientEmail] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    // Create Call Logic
    const handleCreateCall = async () => {
        if (!user) return toast.error("You must be logged in.");
        if (!description) return toast.warn("A description is required.");
        
        const rEmail = recipientEmail.trim();
        const rName = recipientName.trim();

        if (!rName || !rEmail) return toast.warn("Recipient details required.");

        setIsLoading(true);
        const newCallId = Math.random().toString(36).substring(2, 9);
        const callDocRef = doc(db, 'calls', newCallId); 

        try {
            await setDoc(callDocRef, {
                description,
                createdAt: serverTimestamp(),
                ownerId: user._id,
                ownerName: `${user.firstname} ${user.lastname}`,
                ownerEmail: user.email, 
                recipientName: rName,
                recipientEmail: rEmail, 
                access: 'private',
                defaultRole: 'editor',
                allowedEmails: [user.email, rEmail],
                permissions: { [user._id]: 'editor' },
                muteStatus: { [user._id]: false },
            });

            toast.success("Contact added!");
            
            // Reset form and go back to list
            setDescription('');
            setRecipientName('');
            setRecipientEmail('');
            setStep(0);

        } catch (error) {
            console.error("Failed to create call:", error);
            toast.error("Could not save the contact.");
        } finally {
            setIsLoading(false);
        }
    };

    const renderStep = () => {
        switch (step) {
            case 1: // Description Step
                return (
                    <div className="card-body p-4 p-md-5">
                        <h2 className="gradient-title">Call Description</h2>
                        <p className="text-muted mb-4">Give your call a clear and concise description.</p>
                        <textarea
                            className="form-control" rows="3"
                            placeholder="e.g., 'Project check-in'"
                            value={description} onChange={(e) => setDescription(e.target.value)}
                        />
                        <div className="d-flex justify-content-between mt-4">
                            <button className="btn btn-outline-secondary" onClick={() => setStep(0)}>Back to List</button>
                            <button className="btn create-btn" onClick={() => description ? setStep(2) : toast.warn('Description cannot be empty.')}>Next</button>
                        </div>
                    </div>
                );
            case 2: // Invite Step
                return (
                     <div className="card-body p-4 p-md-5">
                        <h2 className="gradient-title">Add New Contact</h2>
                        <p className="text-muted mb-4">Enter the details of the person you want to call.</p>
                        
                        <div className="form-floating mb-3">
                            <input type="text" className="form-control" id="recipientName" placeholder="Name"
                                value={recipientName} onChange={(e) => setRecipientName(e.target.value)} />
                            <label htmlFor="recipientName">Recipient's Name</label>
                        </div>
                        <div className="form-floating">
                            <input type="email" className="form-control" id="recipientEmail" placeholder="Email"
                                value={recipientEmail} onChange={(e) => setRecipientEmail(e.target.value)} />
                            <label htmlFor="recipientEmail">Recipient's Email</label>
                        </div>

                        <div className="d-flex justify-content-between mt-4">
                            <button className="btn btn-outline-secondary" onClick={() => setStep(1)}>Back</button>
                            <button className="btn create-btn" onClick={handleCreateCall} disabled={isLoading}>
                                {isLoading ? 'Saving...' : 'Save Contact'}
                            </button>
                        </div>
                    </div>
                );
            default: // --- Main screen ---
                // We now purely render RecentCalls. We pass it the handler to open the "Add Contact" wizard (setStep 1)
                return (
                    <div className="card-body p-0" style={{height: '600px'}}> 
                       <RecentCalls onAddContact={() => setStep(1)} />
                    </div>
                );
        }
    };

     if (!user) return <div className="container mt-5"><div className="alert alert-danger text-center">You are not logged in.</div></div>;

    return (
        <>
            <Navbar />
         
                <style jsx>{`
                    .calls-page-card { 
                        backdrop-filter: blur(15px); 
                        border: 1px solid rgba(255,255,255,0.1); 
                        overflow: hidden; 
                        background: #111b21;
                        border-radius: 12px;
                        box-shadow: 0 4px 20px rgba(0,0,0,0.5);
                    }
                    .gradient-title { color: #e9edef; font-weight: 700; font-size: 2rem; margin-bottom: 1.5rem; }
                    .create-btn { 
                        background-color: #00a884; 
                        border: none;
                        color: white; 
                        font-weight: 600; 
                        padding: 0.75rem 1.5rem;
                        transition: 0.2s;
                    }
                    .create-btn:hover { background-color: #008f6f; color: white; }
                    .form-control { background-color: #1f2937; border: 1px solid #374051; color: #e9edef; }
                    .form-control:focus { background-color: #1f2937; color: #e9edef; border-color: #00a884; box-shadow: 0 0 0 0.25rem rgba(0, 168, 132, 0.25); }
                    .form-floating label { color: #8696a0; }
                `}</style>
                <div className="card calls-page-card">
                    {renderStep()}
                </div>
        
        </>
    );
}

export default CreateCall;