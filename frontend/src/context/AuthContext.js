import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import axios from 'axios';

export const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const API_URL = process.env.REACT_APP_SERVER_API;
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // ✅ Wrapped in useCallback to avoid redefinition on every render
  const fetchUser = useCallback(async () => {
    try {
      const res = await axios.get(`${API_URL}/profile`, {
        withCredentials: true, // Send the cookie
      });
      setUser(res.data.user);
    } catch (err) {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, [API_URL]); // Only re-create if API_URL changes

  // ✅ Call once on mount (dependency is stable due to useCallback)
  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  const logout = async () => {
    await axios.post(`${API_URL}/logout`, {}, { withCredentials: true });
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, setUser, loading, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
