// frontend/vite-project/src/hooks/useAuth.js
import { useContext } from "react";
import { AuthContext } from "../context/AuthContext";

export function useAuth() {
  const context = useContext(AuthContext); //useContext is the React call that "tunes in" to the context and returns whatever is in its value
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}