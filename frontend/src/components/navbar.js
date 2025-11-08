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
                    --nav-light-bg: #f8f9fa;
                    --nav-light-border: #dee2e6;
                    --nav-light-text: #212529;
                    --nav-light-link-active-border: #0d6efd;
                    --nav-dark-bg: #1e1e2f;
                    --nav-dark-border: rgba(255, 255, 255, 0.1);
                    --nav-dark-text: #ffffff;
                    --nav-dark-link-active-border: #ff4b2b;
                }

                .navbar-custom {
                    transition: background-color 0.3s ease, border-color 0.3s ease;
                }

                /* Light Theme */
                .navbar-custom.theme-light {
                    background-color: var(--nav-light-bg);
                    border-bottom: 1px solid var(--nav-light-border);
                }
                .theme-light .navbar-brand-custom, .theme-light .nav-link-custom {
                    color: var(--nav-light-text);
                }
                .theme-light .nav-link-custom.active::after {
                    background-color: var(--nav-light-link-active-border);
                }
                .theme-light .profile-dropdown .dropdown-menu {
                    --bs-dropdown-bg: var(--nav-light-bg);
                    --bs-dropdown-link-color: var(--nav-light-text);
                    --bs-dropdown-link-hover-bg: #e9ecef;
                    --bs-dropdown-border-color: var(--nav-light-border);
                }

                /* Dark Theme */
                .navbar-custom.theme-dark {
                    background: linear-gradient(135deg, #1a1d23 0%, #20232a 50%, #2c3e50 100%);
                    backdrop-filter: blur(0.5px);
                    border-bottom: 1px solid var(--nav-dark-border);
                }
                 .theme-dark .navbar-brand-custom, .theme-dark .nav-link-custom {
                    color: var(--nav-dark-text);
                }
                .theme-dark .nav-link-custom.active::after {
                    background-color: var(--nav-dark-link-active-border);
                }
                .theme-dark .profile-dropdown .dropdown-menu {
                    --bs-dropdown-bg: #2c3e50;
                    --bs-dropdown-link-color: var(--nav-dark-text);
                    --bs-dropdown-link-hover-bg: #34495e;
                     --bs-dropdown-border-color: var(--nav-dark-border);
                }

                .navbar-brand-custom {
                    background: linear-gradient(135deg, #f12711 0%, #f5af19 30%, #ff6b6b 70%, #ee5a52 100%);
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                    font-size: 1.75rem; /* Slightly smaller for new name */
                    font-weight: 800;
                    letter-spacing: -0.8px;
                    transition: all 0.5s cubic-bezier(0.4, 0, 0.2, 1);
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    gap: 0.5rem;
                }
                
                .navbar-brand-custom:hover {
                    transform: scale(1.05);
                }

                .nav-link-custom {
                    font-weight: 600;
                    transition: all 0.3s ease;
                    padding: 8px 16px;
                    border-radius: 8px;
                    position: relative;
                    text-decoration: none;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }

                .nav-link-custom::after {
                    content: '';
                    position: absolute;
                    bottom: -2px;
                    left: 50%;
                    width: 0;
                    height: 2px;
                    background-color: transparent;
                    transition: all 0.3s ease;
                    transform: translateX(-50%);
                }

                .nav-link-custom:hover::after, .nav-link-custom.active::after {
                    width: 70%;
                }

                .dropdown-toggle.no-caret::after {
                    display: none !important;
                }
                
                .logo-image {
                     width: 30px; /* Adjusted size */
                     height: 30px;
                     filter: drop-shadow(0 0 5px rgba(241, 39, 17, 0.5));
                }
                
                .logo-dark-theme {
                    filter: invert(1) brightness(2) drop-shadow(0 0 5px rgba(241, 39, 17, 0.5));
                }
                `}
            </style>

            <nav className={`navbar navbar-expand-lg sticky-top shadow-sm navbar-custom theme-${theme}`}>
                <div className="container-fluid px-4">
                   {/* <img
                        src={logo} 
                        alt="NETWORK.RANDOMAN Logo"
                        className={`logo-image ${theme === 'dark' ? 'logo-dark-theme' : ''}`}
                    /> */}
                    <Link to={user ? "/new-call" : "/new-call"} className="navbar-brand-custom py-2">
                        NETWORK
                    </Link>

                    <button
                        className="navbar-toggler border-0 p-2"
                        type="button"
                        onClick={() => setIsCollapsed(!isCollapsed)}
                    >
                        <i className={`bi ${isCollapsed ? 'bi-list' : 'bi-x'} text-${theme === 'dark' ? 'white' : 'dark'} fs-4`}></i>
                    </button>

                    <div className={`collapse navbar-collapse ${!isCollapsed ? 'show' : ''}`}>
                        <ul className="navbar-nav ms-auto mb-2 mb-lg-0 gap-1 align-items-lg-center">
                            {user ? (
                                <>
                                    {/* --- UPDATED LINKS --- */}
                                   
                                    <li className="nav-item">
                                        <Link className={`nav-link nav-link-custom ${isActive('/new-call') ? 'active' : ''}`} to="/new-call">
                                            <i className="bi bi-telephone-fill"></i><span>Calls</span>
                                        </Link>
                                    </li>
                                    {/* --- END UPDATED LINKS --- */}


                                    <li className="nav-item ms-lg-3">
                                        <div className="dropdown profile-dropdown">
                                            <a href="#" className="d-block text-decoration-none dropdown-toggle no-caret" data-bs-toggle="dropdown" aria-expanded="false">
                                                {profileImage ? (
                                                    <img src={profileImage} alt="User" width="38" height="38" className="rounded-circle" style={{ objectFit: 'cover' }} />
                                                ) : (
                                                    <i className={`bi bi-person-circle fs-3 text-${theme === 'dark' ? 'white' : 'dark'}`}></i>
                                                )}
                                            </a>
                                            <ul className="dropdown-menu dropdown-menu-end mt-2 shadow-lg">
                                                <li>
                                                    <div className="dropdown-item-text">
                                                        <strong>{user.firstname} {user.lastname}</strong>
                                                        <div className="small opacity-75">{user.email}</div>
                                                    </div>
                                                </li>
                                                <li><hr className="dropdown-divider" /></li>
                                                <li><Link className="dropdown-item d-flex align-items-center gap-2" to="/dashboard"><i className="bi bi-house-fill"></i><span>Dashboard</span></Link></li>
                                                <li><hr className="dropdown-divider" /></li>
                                                <li>
                                                    <button className="dropdown-item d-flex align-items-center gap-2" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
                                                        <i className={`bi ${theme === 'dark' ? 'bi-sun-fill' : 'bi-moon-stars-fill'} fs-5`}></i>
                                                        {theme === 'dark' ? 'Sunshine' : 'Moonbeam'}
                                                    </button>
                                                </li>
                                                <li><hr className="dropdown-divider" /></li>
                                                <li>
                                                    <button className="dropdown-item d-flex align-items-center gap-2" onClick={handleLogout}>
                                                        <i className="bi bi-box-arrow-right"></i> Logout
                                                    </button>
                                                </li>
                                            </ul>
                                        </div>
                                    </li>
                                </>
                            ) : (
                                <li className="nav-item">
                                    <Link className="btn btn-primary rounded-pill px-4" to="/login">
                                        <i className="bi bi-person-fill me-2"></i>Login
                                    </Link>
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