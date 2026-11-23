import { createContext, useContext } from 'react'

export const PresenceContext = createContext(true)
export const useMotionPresent = () => useContext(PresenceContext)
