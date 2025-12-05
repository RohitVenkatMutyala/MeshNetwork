import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.css';
import { db } from '../firebaseConfig';
import { doc, onSnapshot } from 'firebase/firestore';
import logo from '../logo.svg'; // <-- UPDATED PATH

function Navbar() {
    const { user, logout } = useAuth();
    const { theme, setTheme } = useTheme();
    const navigate = useNavigate();
    const location = useLocation(); // Hook to get current path
    const [isCollapsed, setIsCollapsed] = useState(true);
    const [profileImage, setProfileImage] = useState(null);

    useEffect(() => {
        if (!user || !user._id) {
            // Create a default avatar if user is not logged in or has no ID
            const seed = 'Guest';
            setProfileImage(`https://api.dicebear.com/7.x/initials/svg?seed=${seed}`);
            return;
        }

        const userDocRef = doc(db, 'users', user._id);
        const unsubscribe = onSnapshot(userDocRef, (docSnap) => {
            const seed = `${user.firstname} ${user.lastname}`;
            let defaultImage = `https://api.dicebear.com/7.x/initials/svg?seed=${seed}`;

            if (docSnap.exists() && docSnap.data().profileImageURL) {
                setProfileImage(docSnap.data().profileImageURL);
            } else {
                setProfileImage(defaultImage);
            }
        }, (error) => {
            // Handle error (e.g., permissions) by setting default image
            console.error("Error fetching user profile:", error);
            const seed = `${user.firstname} ${user.lastname}`;
            setProfileImage(`https://api.dicebear.com/7.x/initials/svg?seed=${seed}`);
        });

        return () => unsubscribe();
    }, [user]);

    const handleLogout = async () => {
        await logout();
        navigate('/');
    };

    // A helper function to determine if a link is active
    const isActive = (path) => location.pathname === path;

    return (
        <>
            <style>
                {`
                :root {
                    /* WhatsApp Web Dark Palette */
                    --nav-bg: #202c33;
                    --nav-border: rgba(134, 150, 160, 0.15);
                    --nav-text: #e9edef;
                    --nav-text-secondary: #8696a0;
                    --nav-accent: #00a884;
                    --nav-hover: #2a3942;
                    --nav-dropdown-bg: #233138;
                }

                /* Navbar Container */
                .navbar-custom {
                    background-color: var(--nav-bg);
                    border-bottom: 1px solid var(--nav-border);
                    transition: background-color 0.3s ease;
                    height: 64px; /* Fixed height like WA header */
                    z-index: 1050; /* Higher than content sticky headers */
                }

                /* Brand Style */
              .navbar-brand-custom {
                    font-size: 1.1rem;
                    font-weight: 600;
                    color: var(--nav-text) !important;
                    letter-spacing: 0.5px;
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    text-decoration: none !important; /* <--- THIS REMOVES THE LINE */
                }

                /* Navigation Links (Tabs) */
                .nav-link-custom {
                    color: var(--nav-text-secondary) !important;
                    font-weight: 500;
                    font-size: 0.95rem;
                    padding: 8px 16px;
                    border-radius: 24px; /* Pill shape */
                    transition: all 0.2s ease;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }

                .nav-link-custom:hover {
                    background-color: var(--nav-hover);
                    color: var(--nav-text) !important;
                }

                .nav-link-custom.active {
                    background-color: var(--nav-hover);
                    color: var(--nav-accent) !important; /* Green accent for active */
                    position: relative;
                }

                /* Dropdown Menu Customization */
                .profile-dropdown .dropdown-menu {
                    background-color: var(--nav-dropdown-bg);
                    border: 1px solid var(--nav-border);
                    box-shadow: 0 4px 20px rgba(0,0,0,0.5);
                    padding: 8px 0;
                    margin-top: 10px;
                }
                
                .dropdown-item {
                    color: var(--nav-text);
                    padding: 10px 20px;
                    font-size: 0.9rem;
                }
                
                .dropdown-item:hover {
                    background-color: var(--nav-hover);
                    color: var(--nav-text);
                }

                .dropdown-divider {
                    border-top: 1px solid var(--nav-border);
                    opacity: 1;
                }

                .dropdown-item-text {
                    color: var(--nav-text);
                    padding: 8px 20px;
                }
                .text-secondary-custom {
                    color: var(--nav-text-secondary) !important;
                }

                /* Toggler (Mobile) */
                .navbar-toggler {
                    border: none;
                }
                .navbar-toggler:focus {
                    box-shadow: none;
                }
                `}
            </style>

            <nav className="navbar navbar-expand-lg sticky-top navbar-custom">
                <div className="container-fluid px-3">

                    {/* Brand */}
                    <Link to={user ? "/new-call" : "/new-call"} className="navbar-brand-custom">
                        {/* You can add a small logo icon here if you want */}
                        <span>NETWORK</span>
                    </Link>

                    {/* Mobile Toggler */}
                    <button
                        className="navbar-toggler"
                        type="button"
                        onClick={() => setIsCollapsed(!isCollapsed)}
                    >
                        <i className="bi bi-list fs-3" style={{ color: 'var(--nav-text-secondary)' }}></i>
                    </button>

                    {/* Collapsible Content */}
                    <div className={`collapse navbar-collapse ${!isCollapsed ? 'show' : ''}`}>
                        <ul className="navbar-nav ms-auto mb-2 mb-lg-0 align-items-lg-center gap-2">
                            {user ? (
                                <>
                                    {/* --- Calls Tab --- */}
                                  

                                    {/* --- Profile Dropdown --- */}
                                    <li className="nav-item ms-lg-2">
                                        <div className="dropdown profile-dropdown">
                                            <a href="#" className="d-flex align-items-center text-decoration-none dropdown-toggle no-caret" data-bs-toggle="dropdown">
                                                {profileImage ? (
                                                    <img
                                                        src={profileImage}
                                                        alt="User"
                                                        width="35"
                                                        height="35"
                                                        className="rounded-circle"
                                                        style={{ objectFit: 'cover', border: '2px solid var(--nav-hover)' }}
                                                    />
                                                ) : (
                                                    <div className="rounded-circle d-flex align-items-center justify-content-center" style={{ width: '35px', height: '35px', background: 'var(--nav-hover)', color: 'var(--nav-text-secondary)' }}>
                                                        <i className="bi bi-person-fill fs-5"></i>
                                                    </div>
                                                )}
                                            </a>

                                            <ul className="dropdown-menu dropdown-menu-end">
                                                <li>
                                                    <div className="dropdown-item-text">
                                                        <div className="fw-bold">{user.firstname} {user.lastname}</div>
                                                        <div className="small text-secondary-custom">{user.email}</div>
                                                    </div>
                                                </li>
                                                <li><hr className="dropdown-divider" /></li>
                                                <li>
                                                    <button className="dropdown-item d-flex align-items-center gap-2" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
                                                        <i className={`bi ${theme === 'dark' ? 'bi-sun' : 'bi-moon-stars'}`}></i>
                                                        <span>{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
                                                    </button>
                                                </li>
                                                <li>
                                                    <button className="dropdown-item d-flex align-items-center gap-2" onClick={handleLogout}>
                                                        <i className="bi bi-box-arrow-right"></i>
                                                        <span>Logout</span>
                                                    </button>
                                                </li>
                                            </ul>
                                        </div>
                                    </li>
                                </>
                            ) : (
                                <li className="nav-item">
                                    
                                </li>
                            )}
                        </ul>
                    </div>
                </div>
            </nav>
        </>
    );
}

export default Navbar;