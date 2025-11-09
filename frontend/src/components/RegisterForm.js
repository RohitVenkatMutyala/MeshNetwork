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
      {/* 3. UPDATED STYLES TO USE CSS VARIABLES */}
      <style>{`
        :root {
            /* --- NEW: Professional Colors --- */
            --brand-primary: #4A69BD;
            --brand-primary-dark: #3e5aa8;
        }
        body, html {
          height: 100%;
        }
        .auth-container {
          min-height: calc(100vh - 56px); /* 56px for navbar */
          display: flex;
          align-items: center;
          justify-content: center;
          background-color: var(--bs-light-bg-subtle, #f8f9fa);
          padding: 2rem 0;
        }
        .auth-card {
          border: 1px solid var(--bs-border-color-translucent);
          border-radius: 1rem;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
          overflow: hidden;
          background-color: var(--bs-body-bg);
        }
        .auth-welcome-col {
          padding: 3rem;
          background-color: var(--bs-body-bg);
        }
        .auth-form-col {
          padding: 3rem;
          background-color: var(--bs-tertiary-bg);
          border-left: 1px solid var(--bs-border-color-translucent);
        }
        .feature-card {
          background-color: var(--bs-light-bg-subtle);
          border: 1px solid var(--bs-border-color-translucent);
          border-radius: 0.75rem;
          transition: all 0.3s ease;
        }
        .feature-card:hover {
          transform: translateY(-5px);
          box-shadow: 0 5px 15px rgba(0, 0, 0, 0.05);
        }
        .feature-icon {
          font-size: 1.5rem;
          color: var(--brand-primary); /* --- MODIFIED --- */
        }
        
        /* --- MODIFIED: Button Styles --- */
        .btn-primary {
          background-color: var(--brand-primary);
          border-color: var(--brand-primary);
          transition: all 0.3s ease;
        }
        .btn-primary:hover {
          background-color: var(--brand-primary-dark);
          border-color: var(--brand-primary-dark);
          transform: translateY(-2px);
          box-shadow: 0 4px 10px rgba(74, 105, 189, 0.3);
        }
        .btn-outline-primary {
            color: var(--brand-primary);
            border-color: var(--brand-primary);
        }
        .btn-outline-primary:hover {
            background-color: var(--brand-primary);
            border-color: var(--brand-primary);
            color: #fff;
        }
        /* --- END MODIFICATION --- */
        
        .auth-form-col h2, .auth-welcome-col h1 {
          color: var(--bs-body-color);
        }
      `}</style>

      {/* 4. ADD data-bs-theme ATTRIBUTE */}
      <div className="auth-container" data-bs-theme={theme}>
        <div className="container">
          <div className="row justify-content-center">
            <div className="col-lg-10 col-xl-9">
              <div className="card auth-card">
                <div className="row g-0">
                  {/* Left Column - Welcome Section */}
                  <div className="col-lg-6 d-none d-lg-flex align-items-center auth-welcome-col">
                    <div className="text-start">
                      <h1 className="display-5 fw-bold mb-3">
                        Join Network
                      </h1>
                      <p className="text-muted mb-4">
                        Connect securely with peer-to-peer video.
                        Create your account to get started.
                      </p>

                      {/* Feature Highlights */}
                      <div className="row g-3">
                        <div className="col-6">
                          <div className="p-3 feature-card">
                            <div className="feature-icon mb-2"><i className="bi bi-shield-lock-fill"></i></div>
                            <h6 className="fw-semibold mb-0">Secure P2P</h6>
                          </div>
                        </div>
                        <div className="col-6">
                          <div className="p-3 feature-card">
                            <div className="feature-icon mb-2"><i className="bi bi-camera-video-fill"></i></div>
                            <h6 className="fw-semibold mb-0">HD Video</h6>
                          </div>
                        </div>
                        <div className="col-6">
                          <div className="p-3 feature-card">
                            <div className="feature-icon mb-2"><i className="bi bi-people-fill"></i></div>
                            <h6 className="fw-semibold mb-0">1-on-1 Calls</h6>
                          </div>
                        </div>
                        <div className="col-6">
                          <div className="p-3 feature-card">
                            <div className="feature-icon mb-2"><i className="bi bi-lightning-charge-fill"></i></div>
                            <h6 className="fw-semibold mb-0">Low Latency</h6>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Right Column - Register Form */}
                  <div className="col-lg-6 d-flex justify-content-center auth-form-col">
                    <div className="w-100" style={{ maxWidth: '400px' }}>
                      <form onSubmit={handleSubmit}>
                        <div className="text-center mb-4">
                          <i className="bi bi-person-plus-fill" style={{ fontSize: '3rem', color: 'var(--brand-primary)' }}></i>
                          <h2 className="fw-bold mt-2">
                            Create Account
                          </h2>
                        </div>

                        {error && (
                          <div className="alert alert-danger d-flex align-items-center">
                            <i className="bi bi-exclamation-triangle-fill me-2"></i>
                            {error}
                          </div>
                        )}

                        <div className="row mb-3">
                          <div className="col-6">
                            <label className="form-label fw-semibold">First Name</label>
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
                            <label className="form-label fw-semibold">Last Name</label>
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
                          <label className="form-label fw-semibold">Email Address</label>
                          <input
                            type="email"
                            className="form-control"
                            placeholder="you@example.com"
                            value={form.email}
                            onChange={(e) => setForm({ ...form, email: e.target.value })}
                            required
                          />
                        </div>

                        <div className="mb-3">
                          <label className="form-label fw-semibold">Password</label>
                          <div className="input-group">
                            <input
                              type={showPassword ? 'text' : 'password'}
                              className="form-control"
                              placeholder="Create a strong password"
                              value={form.password}
                              onChange={(e) => setForm({ ...form, password: e.target.value })}
                              required
                            />
                            <button
                              type="button"
                              className="btn btn-outline-secondary"
                              onClick={() => setShowPassword(!showPassword)}
                              tabIndex={-1}
                            >
                              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                            </button>
                          </div>
                          <small className="form-text text-muted">
                            8+ characters with letters, numbers & symbols.
                          </small>
                        </div>
                        
                        <input
                          type="hidden"
                          value={form.role}
                          onChange={(e) => setForm({ ...form, role: 'user' })}
                        />

                        <button
                          type="submit"
                          className="btn btn-primary btn-lg w-100 d-flex align-items-center justify-content-center fw-bold mt-4"
                          disabled={loading}
                        >
                          {loading ? (
                            <>
                              <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                              Creating account...
                            </>
                          ) : (
                            <>
                              <i className="bi bi-check-circle-fill me-2"></i>
                              Create My Account
                            </>
                          )}
                        </button>

                        <div className="text-center mt-4 pt-3 border-top">
                          <p className="text-muted mb-2">Already have an account?</p>
                          <Link to="/login" className="btn btn-outline-primary fw-bold">
                            <i className="bi bi-box-arrow-in-right me-2"></i>
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