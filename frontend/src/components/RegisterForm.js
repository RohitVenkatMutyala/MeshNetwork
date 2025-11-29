import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext'; // <-- 1. IMPORT THEME
import { Eye, EyeOff } from 'lucide-react';
import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.css';
import Navbar from './navbar'; // <-- 3. IMPORT Navbar
import Footer from './Footer'; // <-- IMPORT FOOTER

function RegisterForm() {
  const API_URL = process.env.REACT_APP_SERVER_API;
  const [form, setForm] = useState({
    firstname: '',
    lastname: '',
    email: '',
    password: '',
    role: '',
  });

  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const { setUser, user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const { theme } = useTheme(); // <-- 2. GET THEME

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const registrationForm = { ...form, role: 'user' };
      
      const res = await axios.post(`${API_URL}/register`, registrationForm, {
        withCredentials: true,
      });

      setUser(res.data.user);
      navigate('/new-call');
    } catch (err) {
      if (err.response?.data?.message) {
        setError(err.response.data.message);
      } else {
        setError('Registration failed. Please try again.');
      }
      setLoading(false);
    }
  };

  if (user) {
    navigate("/new-call");
    return null;
  }

return (
    <>
      <Navbar />
      
      <style>{`
        :root {
            /* --- THEME VARIABLES (Matching Navbar & Login) --- */
            --nav-bg: #202c33;         
            --nav-accent: #00a884;     
            --nav-text: #e9edef;       
            
            /* Gradient: Steel Blue to Black-ish */
            --brand-gradient: linear-gradient(135deg, #202c33 0%, #0b141a 100%);
            
            /* Background for the page */
            --bg-page: #e2e6ea; 
        }

        /* Dark Mode Overrides for Page Background */
        [data-bs-theme="dark"] .auth-container {
            background-color: #111b21;
            background-image: radial-gradient(#2a3942 1px, transparent 1px);
        }

        .auth-container {
            min-height: calc(100vh - 64px);
            display: flex;
            align-items: center;
            justify-content: center;
            background-color: var(--bg-page);
            background-image: radial-gradient(#cbd5e0 1px, transparent 1px);
            background-size: 20px 20px;
            padding: 2rem 1rem;
            transition: background-color 0.3s ease;
        }

        .auth-card {
            border: none;
            border-radius: 20px;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
            overflow: hidden;
            background-color: #ffffff; /* Force White Card */
            min-height: 600px;
        }

        /* --- Left Column (Features) --- */
        .auth-welcome-col {
            background: var(--brand-gradient);
            padding: 4rem;
            color: var(--nav-text);
            position: relative;
            overflow: hidden;
        }
        
        /* Decorative Circle */
        .auth-welcome-col::before {
            content: '';
            position: absolute;
            top: -100px;
            right: -100px;
            width: 300px;
            height: 300px;
            background: rgba(0, 168, 132, 0.15); /* Teal Tint */
            border-radius: 50%;
        }

        .feature-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 1.5rem;
            margin-top: 2rem;
        }

        .feature-card {
            background: rgba(255, 255, 255, 0.05);
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 15px;
            padding: 1.5rem;
            transition: transform 0.3s ease;
            color: #e9edef;
        }
        .feature-card:hover {
            transform: translateY(-5px);
            background: rgba(255, 255, 255, 0.1);
            border-color: var(--nav-accent);
        }

        .feature-icon {
            font-size: 1.8rem;
            margin-bottom: 0.5rem;
            color: var(--nav-accent);
        }

        /* --- Right Column (Form) --- */
        .auth-form-col {
            padding: 3rem;
            background-color: #ffffff; /* Ensure white bg */
            display: flex;
            align-items: center;
            justify-content: center;
            color: #111b21; /* Force dark text */
        }

        /* --- FORCE INPUTS TO LIGHT MODE STYLE --- */
        .form-control {
            background-color: #ffffff !important;
            color: #111b21 !important;
            border: 1px solid #dfe6e9;
            border-left: none;
            padding: 0.8rem 0.8rem 0.8rem 0;
            font-size: 1rem;
        }
        .form-control::placeholder {
            color: #8696a0 !important;
        }
        .input-group-text {
            background-color: #ffffff !important;
            border: 1px solid #dfe6e9;
            border-right: none;
            color: #54656f !important;
        }
        
        /* Focus States */
        .form-control:focus {
            box-shadow: none;
            border-color: var(--nav-accent);
        }
        .input-group:focus-within .input-group-text {
            border-color: var(--nav-accent);
            color: var(--nav-accent) !important;
        }
        
        /* Buttons */
        .btn-primary {
            background: var(--nav-accent);
            border: none;
            padding: 0.8rem;
            border-radius: 24px;
            font-weight: 600;
            letter-spacing: 0.5px;
            transition: all 0.3s;
            color: #fff;
        }
        .btn-primary:hover {
            background: #008f6f;
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(0, 168, 132, 0.3);
        }

        .btn-outline-primary {
            color: var(--nav-bg);
            border-color: var(--nav-bg);
            border-radius: 50px;
            padding: 0.5rem 1.5rem;
        }
        .btn-outline-primary:hover {
            background-color: var(--nav-bg);
            color: #fff;
        }

        /* Mobile Padding */
        @media (max-width: 992px) {
            .auth-form-col { padding: 2rem; }
        }
      `}</style>

      {/* Pass theme to container for bg */}
      <div className="auth-container" data-bs-theme={theme}>
        <div className="container">
          <div className="row justify-content-center">
            <div className="col-xl-11">
              
              {/* Force 'light' theme on card content */}
              <div className="card auth-card" data-bs-theme="light">
                <div className="row g-0 h-100">
                  
                  {/* LEFT COLUMN (Features - Same as Login) */}
                  <div className="col-lg-6 d-none d-lg-flex flex-column justify-content-center auth-welcome-col">
                    <div style={{ position: 'relative', zIndex: 2 }}>
                        <h1 className="display-6 fw-bold mb-3">Join the Network</h1>
                        <p className="mb-4" style={{ opacity: 0.8, fontSize: '1.1rem', fontWeight: 300 }}>
                            Create your account to start secure, high-fidelity communication today.
                        </p>

                        <div className="feature-grid">
                            <div className="feature-card">
                                <div className="feature-icon"><i className="bi bi-shield-lock"></i></div>
                                <h6 className="fw-bold">End-to-End Secure</h6>
                                <small style={{ opacity: 0.7 }}>Private P2P connections</small>
                            </div>
                            <div className="feature-card">
                                <div className="feature-icon"><i className="bi bi-broadcast"></i></div>
                                <h6 className="fw-bold">Ultra-Low Latency</h6>
                                <small style={{ opacity: 0.7 }}>Real-time interaction</small>
                            </div>
                            <div className="feature-card">
                                <div className="feature-icon"><i className="bi bi-mic-fill"></i></div>
                                <h6 className="fw-bold">Crystal Audio</h6>
                                <small style={{ opacity: 0.7 }}>Noise suppression</small>
                            </div>
                            <div className="feature-card">
                                <div className="feature-icon"><i className="bi bi-hdd-network"></i></div>
                                <h6 className="fw-bold">Decentralized</h6>
                                <small style={{ opacity: 0.7 }}>No central servers</small>
                            </div>
                        </div>
                    </div>
                  </div>

                  {/* RIGHT COLUMN (Register Form) */}
                  <div className="col-lg-6 auth-form-col">
                    <div className="w-100" style={{ maxWidth: '400px' }}>
                      <form onSubmit={handleSubmit}>
                        
                        <div className="text-center mb-4">
                          <div className="d-inline-block p-3 rounded-circle mb-3" style={{ background: '#f0f2f5' }}>
                              <i className="bi bi-person-plus-fill" style={{ fontSize: '2.5rem', color: 'var(--nav-bg)' }}></i>
                          </div>
                          <h2 className="fw-bold" style={{ color: 'var(--nav-bg)' }}>Create Account</h2>
                        </div>

                        {error && (
                          <div className="alert alert-danger d-flex align-items-center p-2 mb-4" style={{fontSize: '0.9rem'}}>
                            <i className="bi bi-exclamation-circle-fill me-2"></i>
                            {error}
                          </div>
                        )}

                        <div className="row mb-3">
                          <div className="col-6">
                            <label className="form-label small fw-bold text-uppercase text-muted">First Name</label>
                            <input
                              type="text"
                              className="form-control"
                              placeholder="John"
                              value={form.firstname}
                              onChange={(e) => setForm({ ...form, firstname: e.target.value })}
                              required
                            />
                          </div>
                          <div className="col-6">
                            <label className="form-label small fw-bold text-uppercase text-muted">Last Name</label>
                            <input
                              type="text"
                              className="form-control"
                              placeholder="Doe"
                              value={form.lastname}
                              onChange={(e) => setForm({ ...form, lastname: e.target.value })}
                              required
                            />
                          </div>
                        </div>

                        <div className="mb-3">
                          <label className="form-label small fw-bold text-uppercase text-muted">Email Address</label>
                          <div className="input-group">
                             <span className="input-group-text"><i className="bi bi-envelope"></i></span>
                            <input
                              type="email"
                              className="form-control"
                              placeholder="name@company.com"
                              value={form.email}
                              onChange={(e) => setForm({ ...form, email: e.target.value })}
                              required
                            />
                          </div>
                        </div>

                        <div className="mb-3">
                          <label className="form-label small fw-bold text-uppercase text-muted">Password</label>
                          <div className="input-group">
                            <span className="input-group-text"><i className="bi bi-key"></i></span>
                            <input
                              type={showPassword ? 'text' : 'password'}
                              className="form-control"
                              placeholder="Create a password"
                              value={form.password}
                              onChange={(e) => setForm({ ...form, password: e.target.value })}
                              required
                            />
                            <button
                              type="button"
                              className="btn btn-outline-secondary"
                              style={{ borderLeft: 'none', borderRadius: '0 8px 8px 0', borderColor: '#dfe6e9' }}
                              onClick={() => setShowPassword(!showPassword)}
                              tabIndex={-1}
                            >
                              {showPassword ? <EyeOff size={18} color="#636e72" /> : <Eye size={18} color="#636e72" />}
                            </button>
                          </div>
                          <small className="form-text text-muted mt-1" style={{fontSize: '0.8rem'}}>
                            Must be at least 8 characters.
                          </small>
                        </div>
                        
                        {/* Hidden Role Input */}
                        <input
                          type="hidden"
                          value={form.role}
                          onChange={(e) => setForm({ ...form, role: 'user' })}
                        />

                        <button
                          type="submit"
                          className="btn btn-primary w-100 mt-3 mb-4 shadow-sm"
                          disabled={loading}
                        >
                          {loading ? (
                            <>
                              <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                              Creating Account...
                            </>
                          ) : (
                            'Sign Up'
                          )}
                        </button>

                        <div className="text-center border-top pt-3">
                          <p className="text-muted mb-2 small">Already have an account?</p>
                          <Link to="/login" className="btn btn-outline-primary btn-sm fw-bold">
                            Sign In Instead
                          </Link>
                        </div>

                      </form>
                    </div>
                  </div>

                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <Footer />
    </>
  );
}

export default RegisterForm;