/**
 * Authentication Module
 * Handles Firebase Auth operations
 */

import { getTodayString } from './utils.js';
import {
    auth,
    db,
    googleProvider,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signInWithPopup,
    signOut,
    onAuthStateChanged,
    updateProfile,
    signInWithRedirect,
    getRedirectResult,
    doc,
    setDoc,
    getDoc,
    updateDoc,
    runTransaction,
    increment,
    query,
    where,
    orderBy,
    limit,
    serverTimestamp,
    onSnapshot,
    deleteDoc,
    deleteField,
    collection,
    getDocs,
    getCountFromServer,
    addDoc,
    writeBatch,
    Timestamp
} from './firebase-config.js';



const authModule = {
    currentUser: null,
    userData: null,

    /**
     * Initialize auth state listener
     */
    async init() {
        // Handle Redirect Result (Mobile Login) - Check this FIRST
        await this.handleRedirectResult();

        onAuthStateChanged(auth, async (user) => {
            this.currentUser = user;
            this.updateUI(user);

            if (user) {
                // Sync user data to Firestore on login
                await this.syncUserToFirestore(user);

                // Refresh UI with fetched user data (e.g. custom avatar)
                this.updateUI(user);

                // Start presence heartbeat immediately
                if (window.app && window.app.startHeartbeat) {
                    window.app.startHeartbeat();
                }
            }
        });
    },

    async handleRedirectResult() {
        try {
            const result = await getRedirectResult(auth);
            if (result && result.user) {
                await this.syncUserToFirestore(result.user);
                sessionStorage.setItem('redirect_login_success', 'true');
                return result.user;
            }
        } catch (error) {
            console.error('Detailed Redirect login error:', error);
            if (window.app && window.app.showAlert) {
                window.app.showAlert('登入失敗', `重新導向發生錯誤: ${this.getErrorMessage(error.code)}`);
            }
        }
        return null;
    },

    /**
     * Update UI based on auth state
     */
    updateUI(user) {
        const loginBtn = document.querySelector('.btn-login');
        const profileEl = document.getElementById('user-profile');
        const userNameEl = document.querySelector('.user-name');
        const userAvatarEl = document.querySelector('.user-avatar');

        if (user) {
            // User is logged in
            if (loginBtn) loginBtn.classList.add('hidden');
            if (profileEl) profileEl.classList.remove('hidden');

            // Update display name and avatar
            const displayName = user.displayName || user.email.split('@')[0];
            const initial = displayName.charAt(0).toUpperCase();

            if (userNameEl) userNameEl.textContent = displayName;
            if (userAvatarEl) {
                if (userAvatarEl) {
                    const avatarData = this.userData?.avatar || user.photoURL;
                    if (avatarData) {
                        if (avatarData.startsWith('data:image') || avatarData.startsWith('http')) {
                            userAvatarEl.innerHTML = `<img src="${avatarData}" alt="${initial}" style="width:100%;height:100%;object-fit:cover;" referrerpolicy="no-referrer">`;
                        } else {
                            userAvatarEl.textContent = initial;
                        }
                    } else {
                        userAvatarEl.textContent = initial;
                    }
                }
            }
        } else {
            // User is logged out
            if (loginBtn) loginBtn.classList.remove('hidden');
            if (profileEl) profileEl.classList.add('hidden');
        }
    },

    /**
     * Sync user data to Firestore
     */
    async syncUserToFirestore(user) {
        const userRef = doc(db, 'users', user.uid);
        const userSnap = await getDoc(userRef);

        if (!userSnap.exists()) {
            // New user - use Transaction to get sequential number
            try {
                await runTransaction(db, async (transaction) => {
                    const statsRef = doc(db, 'metadata', 'global_stats');
                    const statsSnap = await transaction.get(statsRef);

                    let nextNumber = 1;
                    if (statsSnap.exists()) {
                        nextNumber = (statsSnap.data().userCount || 0) + 1;
                    }

                    // Update global counter
                    transaction.set(statsRef, { userCount: nextNumber }, { merge: true });

                    // Create user profile
                    transaction.set(userRef, {
                        displayName: user.displayName || user.email.split('@')[0],
                        email: user.email,
                        avatar: user.photoURL || null,
                        userNumber: nextNumber, // Precise #1, #2...
                        subscribedPacks: ['official_v1'],
                        createdAt: serverTimestamp(),
                        lastActive: serverTimestamp(),
                        lastActiveDate: getTodayString(),
                        stats: {
                            soloClears: 0,
                            dailyClears: 0,
                            vsMatches: 0,
                            vsWins: 0
                        }
                    });
                });
                console.log('User synced with precise UID');
                await this.trackDailyActivity(true); // Track new registration
            } catch (e) {

                console.error('Transaction failed:', e);
                // Fallback (non-transactional) if something goes wrong
                await setDoc(userRef, {
                    displayName: user.displayName || user.email.split('@')[0],
                    email: user.email,
                    userNumber: 0,
                    subscribedPacks: ['official_v1'],
                    createdAt: serverTimestamp(),
                    lastActive: serverTimestamp(),
                    lastActiveDate: getTodayString()
                }, { merge: true });
                await this.trackDailyActivity(true); // Track new registration (fallback path)
            }

        } else {
            // User exists - update activity and check for schema updates
            const data = userSnap.data();
            this.userData = data; // Cache user data
            const updates = {
                lastActive: serverTimestamp(),
                lastActiveDate: getTodayString()
            };

            if (!data.subscribedPacks) {
                updates.subscribedPacks = ['official_v1'];
                console.log('Legacy user updated with default packs');
            }

            try {
                const today = getTodayString();
                if (data.lastActiveDate !== today) {
                    await this.trackDailyActivity(false); // Only DAU, not Reg
                }
                await updateDoc(userRef, updates);
            } catch (e) {

                console.error('Failed to update user activity:', e);
            }
        }
    },

    /**
     * Track daily stats (DAU and Reg)
     * @param {boolean} isNewUser 
     */
    async trackDailyActivity(isNewUser) {
        try {
            const today = getTodayString();
            const statsRef = doc(db, 'daily_stats', today);

            const updates = {
                dau: increment(1)
            };
            if (isNewUser) {
                updates.reg = increment(1);
            }

            await setDoc(statsRef, updates, { merge: true });
        } catch (e) {
            console.error('Failed to track daily activity:', e);
        }
    },

    async updateDisplayName(newName) {

        if (!this.currentUser) return { success: false, error: '未登入' };
        try {
            // 1. Update Firebase Auth
            await updateProfile(this.currentUser, { displayName: newName });
            // 2. Update Firestore
            const userRef = doc(db, 'users', this.currentUser.uid);
            await updateDoc(userRef, { displayName: newName });

            // 3. Sync to Today's Daily Leaderboard (if played)
            const today = getTodayString();
            const leaderboardRef = doc(db, 'leaderboard', `daily_${today}`, 'entries', this.currentUser.uid);
            const leaderboardSnap = await getDoc(leaderboardRef);
            if (leaderboardSnap.exists()) {
                await updateDoc(leaderboardRef, { displayName: newName });
            }

            return { success: true };
        } catch (error) {
            console.error('Update name error:', error);
            return { success: false, error: '更新失敗' };
        }
    },

    /**
     * Sign up with email and password
     */
    async signUpWithEmail(email, password, displayName) {
        try {
            const result = await createUserWithEmailAndPassword(auth, email, password);

            // Update display name
            await updateProfile(result.user, { displayName });

            return { success: true, user: result.user };
        } catch (error) {
            console.error('Sign up error:', error);
            return { success: false, error: this.getErrorMessage(error.code) };
        }
    },

    /**
     * Sign in with email and password
     */
    async signInWithEmail(email, password) {
        try {
            const result = await signInWithEmailAndPassword(auth, email, password);
            return { success: true, user: result.user };
        } catch (error) {
            console.error('Sign in error:', error);
            return { success: false, error: this.getErrorMessage(error.code) };
        }
    },

    /**
     * Sign in with Google
     */
    async signInWithGoogle() {
        try {
            // iOS Safari and some mobile browsers have issues with signInWithRedirect.
            // We prioritize signInWithPopup as it's often more reliable if the user allows it.
            try {
                const result = await signInWithPopup(auth, googleProvider);
                return { success: true, user: result.user };
            } catch (popupError) {
                // If popup is blocked, fall back to redirect ONLY on mobile
                if (popupError.code === 'auth/popup-blocked' || popupError.code === 'auth/cancelled-popup-request') {
                    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth <= 768;
                    if (isMobile) {
                        console.log('Popup blocked, falling back to redirect...');
                        await signInWithRedirect(auth, googleProvider);
                        return { success: true };
                    }
                }
                throw popupError;
            }
        } catch (error) {
            console.error('Google sign in error:', error);
            // Show alert for better visibility on mobile
            if (window.app && window.app.showAlert) {
                window.app.showAlert('登入失敗', this.getErrorMessage(error.code));
            }
            return { success: false, error: this.getErrorMessage(error.code) };
        }
    },

    /**
     * Update user stats in Firestore
     */
    async updateUserStats(uid, gameStats) {
        if (!uid) return;
        const userRef = doc(db, 'users', uid);
        const historyRef = collection(db, 'users', uid, 'history');

        try {
            await runTransaction(db, async (transaction) => {
                const userDoc = await transaction.get(userRef);
                if (!userDoc.exists()) return;

                const data = userDoc.data();
                const currentStats = data.stats || {
                    soloClears: 0,
                    dailyClears: 0,
                    vsMatches: 0,
                    vsWins: 0,
                    multiplayerGames: 0,
                    multiplayerTotalScore: 0,
                    totalScore: 0,
                    totalGames: 0
                };

                // Update aggregate stats
                const newStats = { ...currentStats };

                if (gameStats.mode === 'multiplayer') {
                    newStats.multiplayerGames = (newStats.multiplayerGames || 0) + 1;
                    newStats.multiplayerTotalScore = (newStats.multiplayerTotalScore || 0) + gameStats.score;
                    if (gameStats.isWin) {
                        newStats.vsWins = (newStats.vsWins || 0) + 1;
                    }
                    newStats.vsMatches = (newStats.vsMatches || 0) + 1;
                } else if (gameStats.mode === 'solo') {
                    newStats.soloClears = (newStats.soloClears || 0) + 1;
                } else if (gameStats.mode === 'daily') {
                    newStats.dailyClears = (newStats.dailyClears || 0) + 1;
                }

                // Global Total
                newStats.totalGames = (newStats.totalGames || 0) + 1;
                newStats.totalScore = (newStats.totalScore || 0) + gameStats.score;

                transaction.update(userRef, { stats: newStats });
            });

            // Add to history (non-transactional for simplicity)
            await setDoc(doc(historyRef), {
                mode: gameStats.mode,
                steps: gameStats.steps,
                timeSeconds: gameStats.timeSeconds,
                score: gameStats.score,
                completedAt: serverTimestamp(),
                date: new Date().toLocaleDateString('en-CA')
            });

        } catch (e) {
            console.error('Failed to update user stats:', e);
        }
    },

    /**
     * Sign out
     */
    async logout() {
        try {
            await signOut(auth);
            return { success: true };
        } catch (error) {
            console.error('Sign out error:', error);
            return { success: false, error: error.message };
        }
    },

    /**
     * Get user-friendly error messages
     */
    getErrorMessage(code) {
        const messages = {
            'auth/email-already-in-use': '此電子郵件已被使用',
            'auth/invalid-email': '電子郵件格式無效',
            'auth/weak-password': '密碼強度不足（至少 6 個字元）',
            'auth/user-not-found': '找不到此使用者',
            'auth/wrong-password': '密碼錯誤',
            'auth/too-many-requests': '嘗試次數過多，請稍後再試',
            'auth/popup-closed-by-user': '登入視窗已關閉',
            'auth/network-request-failed': '網路連線失敗'
        };
        return messages[code] || '發生未知錯誤';
    }
};

// Export
export default authModule;
export {
    auth,
    db,
    doc,
    setDoc,
    getDoc,
    updateDoc,
    runTransaction,
    increment,
    query,
    where,
    orderBy,
    limit,
    serverTimestamp,
    collection,
    getDocs,
    onSnapshot,
    deleteDoc,
    deleteField,
    getCountFromServer,
    addDoc,
    onAuthStateChanged,
    writeBatch,
    Timestamp
};


