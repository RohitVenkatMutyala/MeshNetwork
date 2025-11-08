import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext'; // <-- 1. IMPORT THEME
import { Eye, EyeOff } from 'lucide-react';
import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.css';
import Navbar from './navbar';
function LoginForm() {
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();
  const { setUser, user } = useAuth();
  const { theme } = useTheme(); // <-- 2. GET THEME

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    const API_URL = process.env.REACT_APP_SERVER_API;

    try {
      const res = await axios.post(`${API_URL}/login`, form, {
        withCredentials: true,
      });

      setUser(res.data.user);
      navigate('/new-call');
    } catch (err) {
      setError('Login failed. Please check your credentials.');
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
        body, html {
          height: 100%;
        }
        .auth-container {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background-color: var(--bs-light-bg-subtle, #f8f9fa);
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
          color: var(--bs-primary);
        }
        .btn-primary {
          background-color: var(--bs-primary);
          border: none;
          transition: all 0.3s ease;
        }
        .btn-primary:hover {
          background-color: var(--bs-primary-dark);
          transform: translateY(-2px);
          box-shadow: 0 4px 10px rgba(var(--bs-primary-rgb), 0.3);
        }
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
                        Welcome to MeshNetwork
                      </h1>
                      <p className="text-muted mb-4">
                        Secure, 1-on-1 video calls powered by a
                        peer-to-peer mesh network.
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

                  {/* Right Column - Login Form */}
                  <div className="col-lg-6 d-flex justify-content-center auth-form-col">
                    <div className="w-100" style={{ maxWidth: '400px' }}>
                      <form onSubmit={handleSubmit}>
                        <div className="text-center mb-4">
                          <i className="bi bi-person-circle text-primary" style={{ fontSize: '3rem' }}></i>
                          <h2 className="fw-bold mt-2">
                            Sign In
                          </h2>
                          <p className="text-muted">Access your MeshNetwork account.</p>
                        </div>

                        {error && (
                          <div className="alert alert-danger d-flex align-items-center">
                            <i className="bi bi-exclamation-triangle-fill me-2"></i>
                            {error}
                          </div>
                        )}

                        <div className="mb-3">
                          <label className="form-label fw-semibold">Email Address</label>
                          <div className="input-group">
                             <span className="input-group-text"><i className="bi bi-envelope-fill"></i></span>
                            <input
                              type="email"
                              className="form-control"
                              placeholder="you@example.com"
                              value={form.email}
                              onChange={(e) => setForm({ ...form, email: e.target.value })}
                              required
                            />
                          </div>
                        </div>

                        <div className="mb-3">
                          <label className="form-label fw-semibold">Password</label>
                          <div className="input-group">
                            <span className="input-group-text"><i className="bi bi-lock-fill"></i></span>
                            <input
                              type={showPassword ? 'text' : 'password'}
                              className="form-control"
                              placeholder="Your password"
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
                        </div>

                        <button
                          type="submit"
                          className="btn btn-primary btn-lg w-100 d-flex align-items-center justify-content-center fw-bold mt-4"
                          disabled={loading}
                        >
                          {loading ? (
                            <>
                              <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
                              Signing in...
                            </>
                          ) : (
                            <>
                              <i className="bi bi-box-arrow-in-right me-2"></i>
                              Sign In
                            </>
                          )}
                        </button>

                        <div className="text-center mt-4 pt-3 border-top">
                          <p className="text-muted mb-2">Don't have an account?</p>
                          <Link to="/register" className="btn btn-outline-primary fw-bold">
                            <i className="bi bi-person-plus-fill me-2"></i>
                            Create Account
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
    </>
  );
}

export default LoginForm;