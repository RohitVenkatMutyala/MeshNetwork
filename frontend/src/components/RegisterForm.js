import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { Eye, EyeOff, Video, Shield, Users, Mic, Monitor, Globe } from 'lucide-react';
import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.css';
import Navbar from './navbar';
import Footer from './Footer';
import { ShieldCheck } from "lucide-react";

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
  const { theme } = useTheme();

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

  // Feature Data for the Grid
  const features = [
     { icon: <Users size={32} />, title: " Meetings", desc: "Create group rooms instantly. Invite multiple participants with a single link.", color: "text-teal" },
    { icon: <Video size={32} />, title: "HD Video Calling", desc: "Crystal clear 1080p video with adaptive bitrate streaming.", color: "text-teal" },
    { icon: <Shield size={32} />, title: "End-to-End Secure", desc: "Your conversations are encrypted via WebRTC peer-to-peer protocols.", color: "text-purple" },
    { icon: <Users size={32} />, title: "Group Calls", desc: "Host meetings with up to 10 participants with ease and stability.", color: "text-teal" },
   // { icon: <Mic size={32} />, title: "Noise Cancellation", desc: "Advanced audio processing to filter out background noise.", color: "text-purple" },
   {
  icon: <ShieldCheck size={32} />,
  title: "End-to-End Encryption",
  desc: "All chats are protected with AES-256 symmetric encryption. Messages stay encrypted even for network providers — only the sender and receiver can read them.",
  color: "text-blue",
},

    { icon: <Monitor size={32} />, title: "Screen Sharing", desc: "Share your entire screen, a specific window, or a browser tab seamlessly.", color: "text-teal" },
    { icon: <Globe size={32} />, title: "Browser Based", desc: "No downloads required. Works on Chrome, Firefox, Safari, and Edge instantly.", color: "text-purple" },
  ];

  return (
    <>
      <Navbar />
      
      <style>{`
        :root {
            --bg-page: #111b21; 
            --text-primary: #e9edef;
            --text-secondary: #8696a0;
            --input-bg: #202c33;
            --border-color: rgba(255, 255, 255, 0.1);
            --brand-teal: #00a884;
            --brand-purple: #6f42c1;
        }

        body { 
            background-color: var(--bg-page); 
            color: var(--text-primary); 
            font-family: sans-serif; 
            overflow-x: hidden; 
            overflow-y: auto; 
        }

        /* --- CUSTOM SCROLLBAR --- */
        ::-webkit-scrollbar { width: 10px; }
        ::-webkit-scrollbar-track { background: #111b21; }
        ::-webkit-scrollbar-thumb { background: #374051; border-radius: 5px; border: 2px solid #111b21; }
        ::-webkit-scrollbar-thumb:hover { background: #00a884; }

        /* --- HERO SECTION --- */
        .hero-section {
            padding: 80px 20px 40px;
            text-align: center;
            background: radial-gradient(circle at 50% 10%, rgba(0, 168, 132, 0.15) 0%, transparent 50%);
        }
        .hero-title {
            font-size: 3.5rem;
            font-weight: 800;
            background: linear-gradient(135deg, #fff 0%, #8696a0 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            margin-bottom: 20px;
        }
        .hero-subtitle {
            font-size: 1.25rem;
            color: var(--text-secondary);
            max-width: 700px;
            margin: 0 auto 40px;
            line-height: 1.6;
        }

        /* --- FEATURES GRID --- */
        .features-container {
            padding: 40px 20px;
            max-width: 1200px;
            margin: 0 auto;
        }
        .feature-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 24px;
        }
        .feature-card {
            background: rgba(31, 41, 55, 0.4);
            border: 1px solid rgba(255, 255, 255, 0.05);
            border-radius: 20px;
            padding: 30px;
            transition: all 0.3s ease;
            backdrop-filter: blur(10px);
        }
        .feature-card:hover {
            transform: translateY(-10px);
            background: rgba(31, 41, 55, 0.7);
            border-color: rgba(255, 255, 255, 0.15);
            box-shadow: 0 20px 40px rgba(0,0,0,0.3);
        }
        .text-teal { color: var(--brand-teal); }
        .text-purple { color: var(--brand-purple); }

        /* --- REGISTER SECTION (BOTTOM) --- */
        .register-section {
            padding: 80px 20px 100px;
            position: relative;
        }
        .register-bg-glow {
            position: absolute;
            width: 100%; height: 100%;
            top: 0; left: 0;
            background: radial-gradient(circle at 50% 50%, rgba(111, 66, 193, 0.1) 0%, transparent 60%);
            pointer-events: none;
            z-index: 0;
        }

        /* The Register Card Itself */
        .register-card-glass {
            background: rgba(31, 41, 55, 0.8);
            backdrop-filter: blur(16px);
            -webkit-backdrop-filter: blur(16px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 24px;
            padding: 40px;
            max-width: 500px; /* Slightly wider for the 2-column inputs */
            margin: 0 auto;
            position: relative;
            z-index: 1;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
        }

        /* Inputs */
        .form-label { color: var(--text-secondary); font-size: 0.85rem; font-weight: 600; letter-spacing: 0.5px; }
        .form-control {
            background-color: var(--input-bg) !important;
            color: var(--text-primary) !important;
            border: 1px solid var(--border-color);
            border-left: none; padding: 12px; font-size: 1rem;
        }
        .form-control:focus { border-color: var(--brand-teal); background-color: #2a3942 !important; box-shadow: none; }
        .form-control::placeholder { color: #54656f !important; }
        .input-group-text {
            background-color: var(--input-bg) !important;
            border: 1px solid var(--border-color);
            border-right: none; color: var(--text-secondary) !important;
        }
        .input-group:focus-within .input-group-text { border-color: var(--brand-teal); color: var(--brand-teal) !important; }
        .btn-eye { border-left: none; border-radius: 0 8px 8px 0; background-color: var(--input-bg) !important; border-color: var(--border-color); }
        .btn-eye:hover { background-color: #2a3942 !important; }

        /* Gradient Button */
        .btn-glass-primary {
            background: linear-gradient(135deg, rgba(0, 168, 132, 0.8), rgba(0, 143, 111, 1));
            border: 1px solid rgba(255, 255, 255, 0.2);
            color: white; padding: 14px; border-radius: 50px; font-weight: 700; width: 100%;
            transition: 0.3s; letter-spacing: 0.5px;
        }
        .btn-glass-primary:hover { transform: scale(1.02); box-shadow: 0 10px 25px rgba(0, 168, 132, 0.4); color: white; }

        .btn-glass-outline {
            border: 1px solid rgba(255, 255, 255, 0.2); color: var(--text-primary);
            background: transparent; border-radius: 50px; padding: 10px 30px;
            font-size: 0.9rem; transition: 0.3s; display: inline-block; text-decoration: none;
        }
        .btn-glass-outline:hover { border-color: var(--brand-teal); color: var(--brand-teal); background: rgba(0, 168, 132, 0.1); }

        @media (max-width: 768px) {
            .hero-title { font-size: 2.5rem; }
            .register-section { padding: 40px 15px; }
            .register-card-glass { padding: 30px 20px; }
        }
      `}</style>

      {/* --- 1. HERO SECTION --- */ }
      <div className="hero-section">
        <div className="container">
          <h1 className="hero-title">Join The Network</h1>
          <p className="hero-subtitle">
            Experience the future of communication. Create your account to start secure, 
            high-fidelity audio and video calls today. It's free, fast, and secure.
          </p>
          <a href="#register-area" className="btn btn-glass-primary" style={{ maxWidth: '200px' }}>
             Create Account <i className="bi bi-arrow-down-short"></i>
          </a>
        </div>
      </div>

      {/* --- 2. FEATURES GRID --- */}
      <div className="features-container">
        <div className="feature-grid">
            {features.map((feature, index) => (
                <div key={index} className="feature-card">
                    <div className={`mb-3 ${feature.color}`}>{feature.icon}</div>
                    <h4 className="fw-bold mb-2">{feature.title}</h4>
                    <p className="text-secondary mb-0 small">{feature.desc}</p>
                </div>
            ))}
        </div>
      </div>

      {/* --- 3. REGISTER SECTION (BOTTOM) --- */}
      <div id="register-area" className="register-section">
        <div className="register-bg-glow"></div>
        <div className="container">
            <div className="text-center mb-5" style={{ position: 'relative', zIndex: 1 }}>
                <h2 className="fw-bold display-6">Get Started Now</h2>
                <p className="text-secondary">Join thousands of users connecting securely every day.</p>
            </div>

            <div className="register-card-glass">
                <form onSubmit={handleSubmit}>
                    <div className="text-center mb-4">
                        <div className="d-inline-flex p-3 rounded-circle mb-3" style={{ background: 'rgba(0, 168, 132, 0.1)', border: '1px solid rgba(0, 168, 132, 0.2)' }}>
                            <i className="bi bi-person-plus-fill" style={{ fontSize: '2rem', color: '#00a884' }}></i>
                        </div>
                        <h4 className="fw-bold">Create Account</h4>
                    </div>

                    {error && (
                        <div className="alert alert-danger d-flex align-items-center p-2 mb-4" style={{fontSize: '0.9rem', background: 'rgba(220, 53, 69, 0.1)', border: '1px solid rgba(220, 53, 69, 0.2)', color: '#ef5350'}}>
                            <i className="bi bi-exclamation-circle-fill me-2"></i> {error}
                        </div>
                    )}

                    <div className="row mb-3">
                        <div className="col-6">
                            <label className="form-label text-uppercase">First Name</label>
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
                            <label className="form-label text-uppercase">Last Name</label>
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

                    <div className="mb-4">
                        <label className="form-label text-uppercase">Email Address</label>
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

                    <div className="mb-4">
                        <label className="form-label text-uppercase">Password</label>
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
                                className="btn btn-outline-secondary btn-eye"
                                onClick={() => setShowPassword(!showPassword)}
                                tabIndex={-1}
                            >
                                {showPassword ? <EyeOff size={18} color="#8696a0" /> : <Eye size={18} color="#8696a0" />}
                            </button>
                        </div>
                        <small className="text-secondary mt-1 d-block" style={{fontSize: '0.75rem'}}>Must be at least 8 characters.</small>
                    </div>

                    <input type="hidden" value={form.role} onChange={(e) => setForm({ ...form, role: 'user' })} />

                    <button type="submit" className="btn btn-glass-primary mt-2 mb-4" disabled={loading}>
                        {loading ? (
                            <>
                                <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                                Creating Account...
                            </>
                        ) : (
                            'Sign Up'
                        )}
                    </button>

                    <div className="text-center">
                        <p className="text-secondary mb-3 small">Already have an account?</p>
                        <Link to="/login" className="btn btn-glass-outline">
                            Sign In Instead
                        </Link>
                    </div>
                </form>
            </div>
        </div>
      </div>

      <Footer />
    </>
  );
}

export default RegisterForm;