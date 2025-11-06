require('dotenv').config();
const express = require('express');
const mysql = require('mysql2');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const nodemailer = require('nodemailer');
const multer = require('multer');
const xlsx = require('xlsx');
const QRCode = require('qrcode');
const app = express();
const port = 4000;

// Import dayjs for date/time manipulation (you might need to install: npm install dayjs)
const dayjs = require('dayjs');
// Import dayjs plugins for timezone support and advanced formatting
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');
// *** ADD THIS REQUIRED PLUGIN ***
const minMax = require('dayjs/plugin/minMax');

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(minMax); 
// *** NEW IMPORT: Node-cron for scheduling tasks ***
const cron = require('node-cron'); 

// Set the default timezone for the application
dayjs.tz.setDefault('Asia/Manila');

// Multer setup for handling file uploads in memory
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024 
    },
    fileFilter: (req, file, cb) => {
        
        const allowedMimeTypes = [
            'image/jpeg',
            'image/png',
            'application/pdf',
            'application/msword', 
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document' 
        ];

        if (allowedMimeTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only PNG, JPEG, PDF, DOC, and DOCX are allowed.'), false);
        }
    }
});
// Multer Excel
const uploadExcel = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024 
    },
    fileFilter: (req, file, cb) => {
        const allowedMimeTypes = [
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 
            'application/vnd.ms-excel' 
        ];
        if (allowedMimeTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only Excel files (.xlsx, .xls) are allowed.'), false);
        }
    }
});

// Add this new constant near your existing 'upload' constant in server.js
// Multer for event images (since it's a dedicated image upload)
const uploadEventImage = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    },
    fileFilter: (req, file, cb) => {
        const allowedMimeTypes = ['image/jpeg', 'image/png'];
        if (allowedMimeTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only PNG and JPEG images are allowed.'), false);
        }
    }
});

const uploadSignature = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 1 * 1024 * 1024 // 1MB limit for signature
    },
    fileFilter: (req, file, cb) => {
        // Only allow PNG
        const allowedMimeType = 'image/png';
        if (file.mimetype === allowedMimeType) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only PNG signature images are allowed.'), false);
        }
    }
});


const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'scholarshipdept.grc@gmail.com',
        pass: process.env.EMAIL_PASS
    }
});

app.set('trust proxy', 1);
// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: 'your_secret_key',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production', // only secure cookies in production
        maxAge: 10 * 60 * 1000
    }
}));



const db = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT
}).promise();


app.get('/test-db', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT 1');
        res.send('Database connected successfully');
    } catch (err) {
        res.status(500).send('Database connection error: ' + err.message);
    }
});


let currentSem = null;

// --- fetch the latest semester ---
async function fetchLatestSemester() {
  try {
    const [results] = await db.query('SELECT * FROM Semester ORDER BY id DESC LIMIT 1');
    if (results.length > 0) {
      currentSem = results[0];
      console.log(`🎓 Active Semester Loaded: ${currentSem.semname} (ID: ${currentSem.id})`);
    } else {
      console.warn("⚠️ No semesters found in the database.");
    }
  } catch (error) {
    console.error("❌ Error fetching latest semester:", error);
  }
}


// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'mainpage.html'));
});
// LOGIN 
app.post('/login', async (req, res) => {
    const { username, password } = req.body;

    // Check for current semester early (Only required for standard 'Users' roles, like Scholar)
    const currentSemId = currentSem ? currentSem.id : null;
    

    try {
        // ==========================
        // 1. Check if Admin (Role ID 1)
        // ==========================
        const [adminResults] = await db.query(
            'SELECT id, username, password, role_id, status FROM ScholarAdmin WHERE username = ?',
            [username]
        );

        if (adminResults.length > 0) {
            const adminUser = adminResults[0];
            const isAdminMatch = await bcrypt.compare(password, adminUser.password);

            if (isAdminMatch) {
                // Check for Admin status (Assuming Role ID 1 is the Admin that uses the status column)
                if (adminUser.role_id === 1 && adminUser.status !== 'active') {
                    console.log(`Login denied: Admin user ${username} is inactive.`);
                    return res.status(403).json({ message: 'Login denied: Your account is currently inactive.' });
                }

                // Successful login for ScholarAdmin (Role ID 1)
                req.session.loggedIn = true;
                req.session.user = {
                    id: adminUser.id,
                    role_id: adminUser.role_id,
                    username: adminUser.username
                };
                return res.redirect('/adminDash');
            }
        }

        // ==========================
        // 2. Check if Registrar Head (Role ID 7)
        // ==========================
        const [registrarResults] = await db.query(
            'SELECT id, username, password, role_id FROM RegistrarHead WHERE username = ?',
            [username]
        );

        if (registrarResults.length > 0) {
            const registrarUser = registrarResults[0];
            const isRegistrarMatch = await bcrypt.compare(password, registrarUser.password);

            if (isRegistrarMatch) {
                // Successful login for RegistrarHead (Role ID 7)
                req.session.loggedIn = true;
                req.session.user = {
                    id: registrarUser.id,
                    role_id: registrarUser.role_id,
                    username: registrarUser.username
                };
                return res.redirect('/registrarDash'); // Redirect to the new dashboard
            }
        }


        // ==========================
        // 3. Check users (current semester for non-admin/registrar roles)
        // ==========================
        if (!currentSemId) {
            // Only display this error if the username didn't match an Admin or RegistrarHead
            // who don't rely on the current semester.
            return res.status(503).json({ message: 'System error: Current active semester is not yet loaded or set.' });
        }

        const [userResults] = await db.query(
            'SELECT * FROM Users WHERE username = ? AND sem_id = ?',
            [username, currentSemId]
        );

        if (userResults.length > 0) {
            // 🔑 Loop through all users with same username (in case of data anomalies)
            for (const user of userResults) {
                const isUserMatch = await bcrypt.compare(password, user.password);
                
                if (isUserMatch) {
                    
                    // --- BLOCKING & EXIT CHECK FOR SCHOLARS (role_id 2) ---
                    if (user.role_id === 2) {
                        
                        // STEP 1: Find the actual Scholar ID using the User ID
                        const [scholarRows] = await db.query(
                            'SELECT id FROM Scholar WHERE user_id = ?', 
                            [user.id] // user.id is the Users.id, which links to Scholar.user_id
                        );

                        // Extract the actual scholar ID
                        const scholarId = scholarRows.length > 0 ? scholarRows[0].id : null;
                        
                        if (scholarId) {
                            
                            // 🌟 NEW STEP 2: Check ExitAccounts
                            const [exitRows] = await db.query(
                                'SELECT id FROM ExitAccounts WHERE scholar_id = ? AND sem_id = ?',
                                [scholarId, currentSemId]
                            );
                            
                            if (exitRows.length > 0) {
                                // Scholar has officially exited for the current semester, prevent login
                                console.log(`Login denied: Scholar ID ${scholarId} has officially exited.`);
                                return res.status(403).json({ 
                                    message: 'Login denied: Your account is marked as officially exited for this semester.' 
                                });
                            }

                            // STEP 3: Check BlockedAccounts (Existing Logic)
                            const [blockedRows] = await db.query(
                                'SELECT id FROM BlockedAccounts WHERE scholar_id = ? AND sem_id = ?',
                                [scholarId, currentSemId]
                            );
                            
                            if (blockedRows.length > 0) {
                                // Scholar is blocked for the current semester, prevent login
                                console.log(`Login denied: Scholar ID ${scholarId} is blocked.`);
                                return res.status(403).json({ 
                                    message: 'Login denied: Your scholar account is currently blocked for this semester. Please contact the scholarship office.' 
                                });
                            }
                        }
                    }
                    // --- END BLOCKING & EXIT CHECK ---
                    
                    // If not blocked or exited, proceed with login:
                    req.session.loggedIn = true;
                    req.session.user = {
                        id: user.id,
                        role_id: user.role_id,
                        username: user.username,
                        sem_id: user.sem_id
                    };
                    
                    // === 🌟 START: CHURCH PERSONNEL (Role 3) LOGIN LOGIC 🌟 ===
                    if (user.role_id === 3) {
                        const [chpRows] = await db.query(
                            'SELECT id FROM ChurchPersonnel WHERE user_id = ?',
                            [user.id]
                        );
                        
                        const churchPersonnelId = chpRows.length > 0 ? chpRows[0].id : null;
                        
                        if (churchPersonnelId) {
                            // Store the ChurchPersonnel ID in the session for later use
                            req.session.user.chp_id = churchPersonnelId;
                            
                            // Initialize the global variables for the attendance system
                            await initializeGlobalVariables(churchPersonnelId);
                            
                            return res.redirect('/chPersonnelDash');
                        } else {
                            // Should not happen if data is consistent, but handles case where User exists but ChurchPersonnel doesn't
                            console.warn(`User ID ${user.id} has role 3 but no corresponding ChurchPersonnel record.`);
                            // Fall through to show 'Incorrect Username or Password'
                        }
                    }
                    // === 🌟 END: CHURCH PERSONNEL LOGIN LOGIC 🌟 ===
                    
                    // Redirect based on other roles
                    if (user.role_id === 2) return res.redirect('/scholarDash');
                    if (user.role_id === 6) {
                        await updateValidatorStatus(user.id, 'online');
                        return res.redirect('/validatorDash');
                    }
                    if (user.role_id === 5) return res.redirect('/monitoringDash');
                    if (user.role_id === 4) return res.redirect('/schoPersonnelDash');
                    
                    // Catch-all for logged-in users with unhandled roles
                    return res.status(403).json({ message: 'Login successful, but role dashboard not defined.' });
                }
            }
        }

        // ==========================
        // 4. No match found
        // ==========================
        return res.status(401).json({ message: 'Incorrect Username or Password' });

    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
});


async function updateValidatorStatus(userId, status) {
    const query = 'UPDATE ValidatorInfo SET status = ? WHERE user_id = ?';
    try {
        const [results] = await db.execute(query, [status, userId]);
        console.log(`Validator with user_id ${userId} status updated to: ${status}`);
        return true;
    } catch (error) {
        console.error(`Error updating validator status for user_id ${userId}:`, error);
        return false;
    }
}
app.get('/logout', async (req, res) => {
    const userId = req.session.user ? req.session.user.id : null;
    const roleId = req.session.user ? req.session.user.role_id : null;

    if (userId && roleId === 6) {
        try {
            await updateValidatorStatus(userId, 'offline');
        } catch (error) {
            console.error('Error updating validator status on logout:', error);
        }
    }

    req.session.destroy(err => {
        if (err) {
            console.error('Error destroying session:', err);
            return res.redirect('/mainpage.html');
        }
        res.clearCookie('connect.sid');
        console.log(`User ${userId} logged out successfully.`);
        res.redirect('/mainpage.html');
    });
});






// Protected Route for Admin (Role ID 1)
app.get('/adminDash', (req, res) => {
    if (req.session.loggedIn && req.session.user.role_id === 1) { 
        res.sendFile(path.join(__dirname, 'private', 'adminDash.html'));
    } else {
        res.redirect('/mainpage.html');
    }
});

// Protected Route for Registrar Head (Role ID 7)
app.get('/registrarDash', (req, res) => {
    if (req.session.loggedIn && req.session.user.role_id === 7) { 
        res.sendFile(path.join(__dirname, 'private', 'registrarDash.html'));
    } else {
        res.redirect('/mainpage.html');
    }
});

// Protected Route for Scholar (Keep as is)
app.get('/scholarDash', (req, res) => {
    if (req.session.loggedIn && req.session.user.role_id === 2) { 
        res.sendFile(path.join(__dirname, 'private', 'scholarDash.html'));
    } else {
        res.redirect('/mainpage.html');
    }
});


// Protected Route for Validator (Keep as is)
app.get('/validatorDash', (req, res) => {
    if (req.session.loggedIn && req.session.user.role_id === 6) { 
        res.sendFile(path.join(__dirname, 'private', 'validatorDash.html'));
    } else {
        res.redirect('/mainpage.html');
    }
});


// Protected Route for Monitoring Personnel (Keep as is)
app.get('/monitoringDash', (req, res) => {
    if (req.session.loggedIn && req.session.user.role_id === 5) { 
        res.sendFile(path.join(__dirname, 'private', 'monitoringDash.html'));
    } else {
        res.redirect('/mainpage.html');
    }
});

// Protected Route for SchoPersonnel (Keep as is)
app.get('/schoPersonnelDash', (req, res) => {
    if (req.session.loggedIn && req.session.user.role_id === 4) { 
        res.sendFile(path.join(__dirname, 'private', 'schoPersonnelDash.html'));
    } else {
        res.redirect('/mainpage.html');
    }
});

// Protected Route for Ch Personnel (Keep as is)
app.get('/chPersonnelDash', (req, res) => {
    if (req.session.loggedIn && req.session.user.role_id === 3) { 
        res.sendFile(path.join(__dirname, 'private', 'chPersonnelDash.html'));
    } else {
        res.redirect('/mainpage.html');
    }
});


// Fetch user profile data (for all users)
app.get('/profile', async (req, res) => {
    if (!req.session.loggedIn) {
        return res.status(401).send('Unauthorized');
    }

    const { role_id, id } = req.session.user;
    let query;

    if (role_id === 1) {
        query = 'SELECT surname, firstname, email, profile FROM ScholarAdmin WHERE id = ?';
    } else if (role_id === 2) {
        query = 'SELECT surname, firstname, email, profile FROM Scholar WHERE user_id = ?';
    } else if (role_id === 3) {
        query = 'SELECT surname, firstname, email, profile FROM ChurchPersonnel WHERE user_id = ?';
    } else if (role_id === 4) {
        query = 'SELECT surname, firstname, email, profile FROM SchoPersonnel WHERE user_id = ?';
    } else if (role_id === 5) {
        query = 'SELECT surname, firstname, email, profile FROM MonitoringInfo WHERE user_id = ?';
    } else if (role_id === 6) {
        query = 'SELECT surname, firstname, email, profile FROM ValidatorInfo WHERE user_id = ?';
    } else if (role_id === 7) {
        // === ADDED: Registrar Head profile fetching ===
        query = 'SELECT surname, firstname, email, profile FROM RegistrarHead WHERE id = ?';
    } else {
        return res.status(400).send('Invalid role');
    }

    try {
        const [results] = await db.query(query, [id]);
        if (results.length === 0) {
            return res.status(404).send('User not found.');
        }
        res.json(results[0]);
    } catch (err) {
        console.error('Error fetching profile:', err);
        res.status(500).send('Error fetching profile.');
    }
});


// profile picture upload
app.post('/upload-profile-picture', upload.single('profilePicture'), async (req, res) => {
    if (!req.session.loggedIn) {
        return res.status(401).send('Unauthorized');
    }
    if (!req.file) {
        return res.status(400).send('No file was uploaded.');
    }

    const { id, role_id } = req.session.user;
    const profilePicture = req.file.buffer;

    let tableName, userIdColumn;
    if (role_id === 1) {
        tableName = 'ScholarAdmin';
        userIdColumn = 'id';
    } else if (role_id === 2) {
        tableName = 'Scholar';
        userIdColumn = 'user_id';
    } else if (role_id === 3) {
        tableName = 'ChurchPersonnel';
        userIdColumn = 'user_id';
    } else if (role_id === 4) {
        tableName = 'SchoPersonnel';
        userIdColumn = 'user_id';
    } else if (role_id === 5) {
        tableName = 'MonitoringInfo';
        userIdColumn = 'user_id';
    } else if (role_id === 6) {
        tableName = 'ValidatorInfo';
        userIdColumn = 'user_id';
    } else if (role_id === 7) {
        // === ADDED: Registrar Head profile picture upload logic ===
        tableName = 'RegistrarHead';
        userIdColumn = 'id';
    } else {
        return res.status(400).send('Invalid role for profile picture upload.');
    }

    const query = `UPDATE ${tableName} SET profile = ? WHERE ${userIdColumn} = ?`;
    try {
        const [results] = await db.query(query, [profilePicture, id]);
        if (results.affectedRows === 0) {
            return res.status(404).send('User not found or no changes made.');
        }
        res.send('Profile picture uploaded successfully.');
    } catch (err) {
        console.error('Error uploading profile picture:', err);
        res.status(500).send('Error uploading profile picture.');
    }
});

// Helper function to get the correct table and ID column based on role_id
function getUserTableInfo(role_id) {
    let tableName, idColumn, emailColumn = 'email'; // Default email column name

    if (role_id === 1) {
        tableName = 'ScholarAdmin';
        idColumn = 'id';
    } else if (role_id === 2) {
        tableName = 'Scholar';
        idColumn = 'user_id';
    } else if (role_id === 3) {
        tableName = 'ChurchPersonnel';
        idColumn = 'user_id';
    } else if (role_id === 4) {
        tableName = 'SchoPersonnel';
        idColumn = 'user_id';
    } else if (role_id === 5) {
        tableName = 'MonitoringInfo';
        idColumn = 'user_id';
    } else if (role_id === 6) {
        tableName = 'ValidatorInfo';
        idColumn = 'user_id';
    } else if (role_id === 7) {
        // === ADDED: Registrar Head table info ===
        tableName = 'RegistrarHead';
        idColumn = 'id';
    } else {
        return null;
    }

    return { tableName, idColumn, emailColumn };
}
// --- NEW SECURITY OTP: SEND (CORRECTED) (Keep as is, relies on updated getUserTableInfo) ---
app.post('/send-security-otp', async (req, res) => {
    if (!req.session.loggedIn) {
        return res.status(401).send('Unauthorized');
    }

    const { id, role_id } = req.session.user;
    const userTableInfo = getUserTableInfo(role_id);

    if (!userTableInfo) {
           return res.status(400).send('Invalid user role.');
    }
    
    const { tableName, idColumn, emailColumn } = userTableInfo;

    try {
        // Query using the correct table name and ID column for the user's role
        const [results] = await db.query(`SELECT ${emailColumn} FROM ${tableName} WHERE ${idColumn} = ?`, [id]); 
        
        if (results.length === 0 || !results[0][emailColumn]) {
            return res.status(404).send('User email not found. Cannot send OTP.');
        }

        const userEmail = results[0][emailColumn];
        
        // Generate and store OTP
        const otp = Math.floor(100000 + Math.random() * 900000);
        req.session.securityOTP = otp;
        req.session.securityOtpExpiry = Date.now() + 5 * 60 * 1000; // 5 minutes expiry

        const mailOptions = {
            from: 'your.sender.email@gmail.com', 
            to: userEmail,
            subject: 'Security Update OTP Confirmation',
            text: `Your OTP for changing your profile settings is: ${otp}. This OTP is valid for 5 minutes.`
        };

        await transporter.sendMail(mailOptions);
        res.status(200).send('OTP sent to your email.');

    } catch (error) {
        console.error('Error sending security OTP email:', error);
        res.status(500).send('Failed to send OTP. Please try again.');
    }
});

// --- NEW SECURITY OTP: VERIFY & UPDATE (CORRECTED) (Logic updated for RegistrarHead password update) ---
app.post('/verify-security-otp', async (req, res) => {
    if (!req.session.loggedIn) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    
    const { otp, action, data } = req.body; 
    const sessionOTP = req.session.securityOTP;
    const otpExpiry = req.session.securityOtpExpiry;

    // 1. OTP Validation (Remains the same)
    if (!sessionOTP || Date.now() > otpExpiry) {
        return res.status(400).json({ success: false, message: 'OTP is expired or not set. Please request a new one.' });
    }
    if (otp !== String(sessionOTP)) {
        return res.status(400).json({ success: false, message: 'Invalid OTP.' });
    }

    delete req.session.securityOTP;
    delete req.session.securityOtpExpiry;

    // 2. Determine Table and ID Column based on Action and Role
    const { id, role_id } = req.session.user;
    let tableName, idColumn;

    if (action === 'email') {
        // Use the detailed mapping for email update
        const userTableInfo = getUserTableInfo(role_id);
        if (!userTableInfo) {
               return res.status(400).json({ success: false, message: 'Invalid role for email update.' });
        }
        tableName = userTableInfo.tableName;
        idColumn = userTableInfo.idColumn;
    } else if (action === 'password') {
        // Use the simplified mapping for password update (ScholarAdmin/RegistrarHead vs Users)
        if (role_id === 1) { // Admin
            tableName = 'ScholarAdmin';
            idColumn = 'id';
        } else if (role_id === 7) { // RegistrarHead
            tableName = 'RegistrarHead';
            idColumn = 'id';
        } else { // All other users (Role 2, 3, 4, 5, 6)
            tableName = 'Users';
            idColumn = 'id';
        }
    } else {
        return res.status(400).json({ success: false, message: 'Invalid update action.' });
    }

    // 3. Perform the Update
    try {
        if (action === 'email') {
            const { newEmail } = data;
            
            const [results] = await db.execute(`UPDATE ${tableName} SET email = ? WHERE ${idColumn} = ?`, [newEmail, id]);
            
            if (results.affectedRows === 0) {
                return res.status(404).json({ success: false, message: 'User not found or email is the same.' });
            }
            if (req.session.user.email) {
                 req.session.user.email = newEmail;
            }
            res.json({ success: true, message: 'Email updated successfully.' });

        } else if (action === 'password') {
            const { currentPassword, newPassword } = data;

            // First, verify current password
            const [userResults] = await db.execute(`SELECT password FROM ${tableName} WHERE ${idColumn} = ?`, [id]);
            if (userResults.length === 0) {
                return res.status(404).json({ success: false, message: 'User not found.' });
            }

            const hashedPassword = userResults[0].password;
            const isMatch = await bcrypt.compare(currentPassword, hashedPassword);

            if (!isMatch) {
                return res.status(400).json({ success: false, message: 'Incorrect current password.' });
            }

            // Second, update password
            const newHashedPassword = await bcrypt.hash(newPassword, 10);
            const [updateResults] = await db.execute(`UPDATE ${tableName} SET password = ? WHERE ${idColumn} = ?`, [newHashedPassword, id]);

            if (updateResults.affectedRows === 0) {
                return res.status(500).json({ success: false, message: 'Failed to update password.' });
            }

            res.json({ success: true, message: 'Password updated successfully.' });
        } 
    } catch (error) {
        console.error(`Error during OTP verification and ${action} update:`, error);
        res.status(500).json({ success: false, message: 'Failed to complete update. Please try again.' });
    }
});

// NEW SEMESTER

// OTP
app.post('/send-otp-semester', async (req, res) => {
    if (!req.session.loggedIn || req.session.user.role_id !== 1) {
        return res.status(401).send('Unauthorized');
    }

    const { id } = req.session.user;

    try {
        
        const [results] = await db.query('SELECT email FROM ScholarAdmin WHERE id = ?', [id]);
        if (results.length === 0) {
            return res.status(404).send('Admin not found.');
        }

        const adminEmail = results[0].email;
        if (!adminEmail) {
            return res.status(400).send('Admin email not set.');
        }

        
        const otp = Math.floor(100000 + Math.random() * 900000);
        req.session.semesterOTP = otp;
        req.session.otpExpiry = Date.now() + 5 * 60 * 1000; 

        const mailOptions = {
            from: 'grc.scholarship.dept@gmail.com', 
            to: adminEmail,
            subject: 'Semester Setup OTP Confirmation',
            text: `Your OTP for semester management is: ${otp}. This OTP is valid for 5 minutes.`
        };

        await transporter.sendMail(mailOptions);
        res.status(200).send('OTP sent to your email.');
    } catch (error) {
        console.error('Error sending OTP email:', error);
        res.status(500).send('Failed to send OTP. Please try again.');
    }
});


// VERIFY OTP
app.post('/verify-otp-semester', (req, res) => {
    const { otp } = req.body;
    const sessionOTP = req.session.semesterOTP;
    const otpExpiry = req.session.otpExpiry;

    
    if (!sessionOTP || Date.now() > otpExpiry) {
        return res.status(400).json({ success: false, message: 'OTP is expired or not set. Please request a new one.' });
    }

    
    if (otp !== String(sessionOTP)) {
        return res.status(400).json({ success: false, message: 'Invalid OTP.' });
    }

   
    delete req.session.semesterOTP;
    delete req.session.otpExpiry;
    req.session.otpVerified = true; 

    res.json({ success: true, message: 'OTP verified successfully.' });
});


// ATOMIC SAVE SEMESTER
app.post('/save-semester-transaction', async (req, res) => {
    // 1. Authorization and OTP check
    if (!req.session.loggedIn || req.session.user.role_id !== 1) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    if (!req.session.otpVerified) {
        return res.status(403).json({ success: false, message: 'OTP not verified for this action.' });
    }

    const { semester, scholarSlot, departments, churches } = req.body;
    let connection;

    try {
        connection = await db.getConnection();
        await connection.beginTransaction();

        // 2. End the current semester (if one exists)
        if (currentSem && currentSem.id) {
            const endCurrentSemesterQuery = 'UPDATE Semester SET dateend = ? WHERE id = ?';
            const end_date = new Date().toISOString().slice(0, 10);
            await connection.execute(endCurrentSemesterQuery, [end_date, currentSem.id]);
            console.log(`Current semester (ID: ${currentSem.id}) ended on ${end_date}.`);
        }

        // 3. Insert the new semester
        const start_date = new Date().toISOString().slice(0, 10);
        const semesterQuery = 'INSERT INTO Semester (semname, datestart, dateend, gratis, fellowship, penalty, sService) VALUES (?, ?, ?, ?, ?, ?, ?)';
        const [semesterResults] = await connection.execute(semesterQuery, [semester.name, start_date, semester.endDate, semester.gratis, semester.fellowship, semester.penalty, semester.sService]);
        const newSemId = semesterResults.insertId;

        // Update the in-memory currentSem object
        currentSem = {
            id: newSemId,
            semname: semester.name,
            datestart: start_date,
            dateend: semester.endDate,
            gratis: semester.gratis,
            fellowship: semester.fellowship,
            penalty: semester.penalty,
            sService: semester.sService
        };
        console.log('New semester ID:', newSemId);

        // 4. Handle Scholar Slot Limit
        if (scholarSlot && scholarSlot.limit_count !== undefined) {
            await connection.query('INSERT INTO ScholarSlotLimit (limit_count, sem_id) VALUES (?, ?)', [scholarSlot.limit_count, newSemId]);
        }

        // 5. Handle Departments and their slots
        for (const dept of departments) {
            if (String(dept.id).startsWith('temp_')) {
                const [checkResults] = await connection.query('SELECT id FROM Department WHERE deptname = ?', [dept.deptname]);
                if (checkResults.length > 0) {
                    throw new Error(`Department "${dept.deptname}" already exists.`);
                }
                const [insertDeptResults] = await connection.query('INSERT INTO Department (deptname) VALUES (?)', [dept.deptname]);
                const newDeptId = insertDeptResults.insertId;

                // Save limit_count; if Housekeeping, save NULL
                const limitVal = dept.deptname.toLowerCase() === 'housekeeping' ? null : dept.limit_count;
                await connection.query('INSERT INTO DeptSlotLimit (limit_count, dept_id, sem_id) VALUES (?, ?, ?)', [limitVal, newDeptId, newSemId]);

            } else if (dept.deleted) {
                await connection.query('DELETE FROM DeptSlotLimit WHERE dept_id = ?', [dept.id]);
                await connection.query('DELETE FROM Department WHERE id = ?', [dept.id]);

            } else {
                // Update or insert DeptSlotLimit with limit_count or NULL for Housekeeping
                const limitVal = dept.deptname.toLowerCase() === 'housekeeping' ? null : dept.limit_count;
                await connection.query(
                    'INSERT INTO DeptSlotLimit (limit_count, dept_id, sem_id) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE limit_count = ?',
                    [limitVal, dept.id, newSemId, limitVal]
                );
            }
        }


        // 6. Handle Churches and their schedules
        for (const church of churches) {
            if (String(church.id).startsWith('temp_')) { 
                
                const [checkResults] = await connection.query('SELECT id FROM Church WHERE chname = ?', [church.chname]);
                if (checkResults.length > 0) {
                    throw new Error(`Church "${church.chname}" already exists.`);
                }
                const [insertChurchResults] = await connection.query('INSERT INTO Church (chname) VALUES (?)', [church.chname]);
                const newChurchId = insertChurchResults.insertId;
                if (church.schedule) {
                    const { sched, time_start, time_stop } = church.schedule;
                    await connection.query('INSERT INTO ChSched (ch_id, sem_id, sched, time_start, time_stop, limit_count, avl_slot) VALUES (?, ?, ?, ?, ?, 0, 0)', [newChurchId, newSemId, sched, time_start, time_stop]);
                }
            } else if (church.deleted) { 
                await connection.query('DELETE FROM ChSched WHERE ch_id = ?', [church.id]);
                await connection.query('DELETE FROM Church WHERE id = ?', [church.id]);
            } else if (church.schedule) { 
                const { sched, time_start, time_stop } = church.schedule;
                
                await connection.query('INSERT INTO ChSched (ch_id, sem_id, sched, time_start, time_stop, limit_count, avl_slot) VALUES (?, ?, ?, ?, ?, 0, 0) ON DUPLICATE KEY UPDATE sched = ?, time_start = ?, time_stop = ?', [church.id, newSemId, sched, time_start, time_stop, sched, time_start, time_stop]);
            }
        }

        await connection.commit();
        res.json({ success: true, message: 'New semester, departments, and churches created successfully.' });

    } catch (err) {
        if (connection) {
            await connection.rollback();
        }
        console.error('Error in semester transaction:', err);
        res.status(500).json({ success: false, message: `Transaction failed: ${err.message || 'An unknown error occurred.'}` });
    } finally {
        if (connection) {
            connection.release();
        }
        delete req.session.otpVerified;
    }
});




// Get ALL departments.
app.get('/get-all-departments', async (req, res) => {
    if (!req.session.loggedIn || req.session.user.role_id !== 1) {
        return res.status(401).send('Unauthorized');
    }
    const query = 'SELECT id, deptname FROM Department ORDER BY deptname ASC';
    try {
        const [results] = await db.query(query);
        res.json({ success: true, departments: results });
    } catch (err) {
        console.error('Error fetching departments:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch departments.' });
    }
});

// Get ALL churches
app.get('/get-all-churches', async (req, res) => {
    if (!req.session.loggedIn || req.session.user.role_id !== 1) {
        return res.status(401).send('Unauthorized');
    }
    const query = 'SELECT id, chname FROM Church ORDER BY chname ASC';
    try {
        const [results] = await db.query(query);
        res.json({ success: true, churches: results });
    } catch (err) {
        console.error('Error fetching churches:', err);
        res.status(500).json({ success: false, message: 'Failed to fetch churches.' });
    }
});



// Apply last semester scholar slot
app.get('/get-last-scholar-slot', async (req, res) => {
    if (!req.session.loggedIn || req.session.user.role_id !== 1) {
        return res.status(401).send('Unauthorized');
    }

    const query = `
    SELECT ScholarSlotLimit.limit_count
    FROM ScholarSlotLimit
    WHERE ScholarSlotLimit.sem_id = (
        SELECT MAX(id)
        FROM Semester
        WHERE id < (SELECT MAX(id) FROM Semester)
    )
    `;

    try {
        const [results] = await db.query(query);

        if (results.length > 0) {
            res.json({ success: true, limit_count: results[0].limit_count });
        } else {
            res.json({ success: false, message: 'No previous semester slot limit found.' });
        }
    } catch (err) {
        console.error('Error fetching last scholar slot:', err);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch last scholar slot.'
        });
    }
});

//CURRENT SEM 

app.get('/get-current-semester-details', async (req, res) => {
    if (!req.session.loggedIn || req.session.user.role_id !== 1) {
        return res.status(401).send('Unauthorized');
    }

    
    if (!currentSem) {
        return res.status(404).send('No current semester set.');
    }

    try {
        const semesterId = currentSem.id;

        
        const [semesterDetails] = await db.query('SELECT id, semname, datestart, dateend, gratis, fellowship, penalty, sService FROM Semester WHERE id = ?', [semesterId]);
        const [deptSlots] = await db.query('SELECT DeptSlotLimit.limit_count, Department.deptname, Department.id FROM DeptSlotLimit JOIN Department ON DeptSlotLimit.dept_id = Department.id WHERE DeptSlotLimit.sem_id = ?', [semesterId]);
        const [churchSchedules] = await db.query('SELECT ChSched.sched, ChSched.time_start, ChSched.time_stop, Church.chname, Church.id FROM ChSched JOIN Church ON ChSched.ch_id = Church.id WHERE ChSched.sem_id = ?', [semesterId]);
        const [scholarSlot] = await db.query('SELECT limit_count FROM ScholarSlotLimit WHERE sem_id = ?', [semesterId]);

        
        if (semesterDetails.length === 0) {
            return res.status(404).send('Current semester not found in the database.');
        }

        res.json({
            
            semester: semesterDetails[0], 
            scholarSlot: scholarSlot.length > 0 ? scholarSlot[0] : null,
            departments: deptSlots,
            churches: churchSchedules
        });

    } catch (err) {
        console.error('Error fetching current semester details:', err);
        res.status(500).send('An error occurred while fetching semester details.');
    }
});





// EXTEND SEMESTER
app.post('/extend-semester', async (req, res) => {
    if (!req.session.loggedIn || req.session.user.role_id !== 1 || !req.body.newEndDate) {
        return res.status(401).send('Unauthorized');
    }
    if (!currentSem) {
        return res.status(404).send('No current semester set.');
    }

    const newEndDate = req.body.newEndDate;

    try {
        await db.execute('UPDATE Semester SET dateend = ? WHERE id = ?', [newEndDate, currentSem.id]);
        currentSem.dateend = newEndDate; 
        res.json({ success: true, message: 'Semester end date updated successfully.' });
    } catch (err) {
        console.error('Error extending semester:', err);
        res.status(500).json({ success: false, message: 'Failed to extend semester.' });
    }
});



//CREATE ACCOUNT
app.post('/send-otp-account', async (req, res) => {
    if (!req.session.loggedIn || req.session.user.role_id !== 1) {
        return res.status(401).json({ message: 'Unauthorized' });
    }

    const { id } = req.session.user;

    try {
        const [results] = await db.query('SELECT email FROM ScholarAdmin WHERE id = ?', [id]);
        if (results.length === 0) {
            return res.status(404).json({ message: 'Admin not found.' });
        }

        const adminEmail = results[0].email;
        if (!adminEmail) {
            return res.status(400).json({ message: 'Admin email not set.' });
        }

        const otp = Math.floor(100000 + Math.random() * 900000);
        req.session.accountOTP = otp;
        req.session.accountOtpExpiry = Date.now() + 5 * 60 * 1000; 

        const mailOptions = {
            from: 'grc.scholarship.dept@gmail.com',
            to: adminEmail,
            subject: 'Account Creation OTP Confirmation',
            text: `Your OTP for account creation is: ${otp}. This OTP is valid for 5 minutes.`
        };

        await transporter.sendMail(mailOptions);
        res.status(200).json({ message: 'OTP sent to your email.' });
    } catch (error) {
        console.error('Error sending OTP email:', error);
        res.status(500).json({ message: 'Failed to send OTP. Please try again.' });
    }
});

// OTP for ACCOUNT CREATION
app.post('/verify-otp-account', (req, res) => {
    const { otp } = req.body;
    const sessionOTP = req.session.accountOTP;
    const otpExpiry = req.session.accountOtpExpiry;

    if (!sessionOTP || Date.now() > otpExpiry) {
        return res.status(400).json({ success: false, message: 'OTP is expired or not set. Please request a new one.' });
    }

    if (otp !== String(sessionOTP)) {
        return res.status(400).json({ success: false, message: 'Invalid OTP.' });
    }

    delete req.session.accountOTP;
    delete req.session.accountOtpExpiry;
    
    

    res.json({ success: true, message: 'OTP verified successfully.' });
});


function generateRandomPasswordPart() {
    const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const special = '!@#$%^&*()_+~`|}{[]:;?><,./-=';
    const digit = '0123456789';

    const char1 = uppercase[Math.floor(Math.random() * uppercase.length)];
    const char2 = special[Math.floor(Math.random() * special.length)];
    const char3 = digit[Math.floor(Math.random() * digit.length)];

    return `${char1}${char2}${char3}`;
}


app.get('/get-churches', async (req, res) => {
    try {
        const [results] = await db.query("SELECT id, chname FROM Church");
        res.json(results);
    } catch (err) {
        console.error('Error fetching churches:', err);
        res.status(500).json({ message: 'Failed to fetch churches.' });
    }
});


app.get('/get-roles', async (req, res) => {
    try {
        const [results] = await db.query("SELECT id, role FROM Roles WHERE id IN (3, 4, 5, 6)"); 
        res.json(results);
    } catch (err) {
        console.error('Error fetching roles:', err);
        res.status(500).json({ message: 'Failed to fetch roles.' });
    }
});

async function checkExistingAccount(surname, firstname, roleId, semId) {
    let tableName;
    switch (roleId) {
        case 5: // Monitoring
            tableName = 'MonitoringInfo';
            break;
        case 6: // Validator
            tableName = 'ValidatorInfo';
            break;
        case 4: // Scho Personnel
            tableName = 'SchoPersonnel';
            break;
        case 3: // Church Personnel
            tableName = 'ChurchPersonnel';
            break;
        default:
            return false;
    }

    try {
        const [results] = await db.query(
            // **MODIFIED:** Checking existence based on name AND sem_id
            `SELECT 1 FROM ${tableName} WHERE surname = ? AND firstname = ? AND sem_id = ?`,
            [surname, firstname, semId]
        );
        return results.length > 0;
    } catch (error) {
        console.error('Error checking for existing account:', error);
        throw error;
    }
}


/**
 * Creates a new user account and associated personnel info, including sem_id.
 * @param {object} accountData - Account details.
 * @param {number} semId - The ID of the current semester.
 * @returns {Promise<{success: boolean, message: string}>} Result of the account creation.
 */
async function createAccount(accountData, semId) {
    const { surname, firstname, email, roleId, church } = accountData;

    // **MODIFIED:** Pass semId to checkExistingAccount
    const accountExists = await checkExistingAccount(surname, firstname, roleId, semId);
    if (accountExists) {
        return { success: false, message: `Skipped: An account for ${firstname} ${surname} already exists in this role for the current semester.` };
    }

    let usernamePrefix;
    if (roleId === 5) {
        usernamePrefix = 'monitor';
    } else if (roleId === 6) {
        usernamePrefix = 'validator';
    } else if (roleId === 4) {
        usernamePrefix = 'schopersonnel';
    } else if (roleId === 3) {
        usernamePrefix = 'chpersonnel';
        if (!church) {
            return { success: false, message: `Failed: Church must be selected for Church Personnel.` };
        }
    } else {
        return { success: false, message: 'Failed: Invalid role selected.' };
    }

    const username = `${usernamePrefix}${surname.replace(/\s/g, '')}`;
    const randomPasswordPart = generateRandomPasswordPart();
    const plainPassword = `${surname}${randomPasswordPart}`;
    const hashedPassword = await bcrypt.hash(plainPassword, 10);

    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();

        // Users table insertion already includes sem_id (using currentSem.id from the route, which is passed as semId)
        const userInsertQuery = 'INSERT INTO Users (username, password, role_id, status, sem_id) VALUES (?, ?, ?, ?, ?)';
        // Note: The user's original code had currentSem.id here, but since the route now passes semId, we use semId
        const [userInsertResult] = await connection.execute(userInsertQuery, [username, hashedPassword, roleId, 'enabled', semId]);
        const userId = userInsertResult.insertId;

        let userInfoInsertQuery;
        let userInfoParams;

        // **MODIFIED:** Update all INFO tables to include sem_id column and value
        if (roleId === 5) {
            userInfoInsertQuery = `INSERT INTO MonitoringInfo (surname, firstname, email, user_id, sem_id) VALUES (?, ?, ?, ?, ?)`;
            userInfoParams = [surname, firstname, email, userId, semId];
        } else if (roleId === 6) {
            userInfoInsertQuery = `INSERT INTO ValidatorInfo (surname, firstname, email, user_id, sem_id) VALUES (?, ?, ?, ?, ?)`;
            userInfoParams = [surname, firstname, email, userId, semId];
        } else if (roleId === 4) {
            userInfoInsertQuery = `INSERT INTO SchoPersonnel (surname, firstname, email, user_id, sem_id) VALUES (?, ?, ?, ?, ?)`;
            userInfoParams = [surname, firstname, email, userId, semId];
        } else if (roleId === 3) {
            userInfoInsertQuery = `INSERT INTO ChurchPersonnel (surname, firstname, email, user_id, church_id, sem_id) VALUES (?, ?, ?, ?, ?, ?)`;
            userInfoParams = [surname, firstname, email, userId, church, semId];
        }

        await connection.execute(userInfoInsertQuery, userInfoParams);
        await connection.commit();

        const mailOptions = {
            from: 'scholarshipdept.grc@gmail.com',
            to: email,
            subject: 'Your Account Details',
            text: `Hello ${firstname},\n\nYour account has been created.\n\nUsername: ${username}\nPassword: ${plainPassword}\n\nPlease change your password after logging in.`
        };
         await transporter.sendMail(mailOptions);
        console.log(`Simulated Account email send: to ${email}`); // Log instead of sending for testing

        return { success: true, message: `Account created for ${firstname} ${surname}.` };
    } catch (error) {
        if (connection) {
            await connection.rollback();
        }
        console.error(`Error creating account for role ${roleId}:`, error);
        return { success: false, message: `Failed to create account for ${firstname} ${surname}. Transaction rolled back.` };
    } finally {
        if (connection) {
            connection.release();
        }
    }
}

// Single Account Creation
app.post('/create-account', async (req, res) => {
    const { surname, firstname, email, role, church } = req.body;
    if (!currentSem) {
        return res.status(400).json({ message: 'No semester set yet.' });
    }
    const roleId = parseInt(role);
    const semId = currentSem.id; // Get the current semester ID

    // **MODIFIED:** Pass semId to createAccount
    const result = await createAccount({ surname, firstname, email, roleId, church }, semId);
    if (result.success) {
        res.status(200).json(result);
    } else {
        res.status(result.message.startsWith('Skipped') ? 409 : 400).json(result);
    }
});


// Read excel file
app.post('/create-multiple-accounts', uploadExcel.single('excelFile'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'No file uploaded.' });
    }

    if (!currentSem) {
        return res.status(400).json({ message: 'No semester set yet.' });
    }

    const semId = currentSem.id; // Get the current semester ID

    try {
        // Assuming xlsx and uploadExcel are available
        const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = xlsx.utils.sheet_to_json(worksheet);

        const [allChurches] = await db.query("SELECT id, chname FROM Church");
        const [allRoles] = await db.query("SELECT id, role FROM Roles WHERE id IN (3, 4, 5, 6)");
        const churchMap = new Map(allChurches.map(c => [c.chname.toLowerCase().trim(), c.id]));
        const roleMap = new Map(allRoles.map(r => [r.role.toLowerCase().trim(), r.id]));


        const roleAliases = {
            'church personnel': 'ch personnel',
            'scholar personnel': 'scho personnel'
        };

        const results = [];
        for (const row of jsonData) {
            const surname = row.Surname ? String(row.Surname).trim() : null;
            const firstname = row.Firstname ? String(row.Firstname).trim() : null;
            const email = row.Email ? String(row.Email).trim() : null;
            let roleName = row.Role ? String(row.Role).toLowerCase().trim() : null;
            const churchName = row.Church ? String(row.Church).toLowerCase().trim() : null;


            if (roleAliases[roleName]) {
                roleName = roleAliases[roleName];
            }

            if (!surname || !firstname || !email || !roleName) {
                results.push({ success: false, message: `Skipped: Incomplete data for a row.` });
                continue;
            }

            const roleId = roleMap.get(roleName);
            const churchId = churchName ? churchMap.get(churchName) : null;

            if (!roleId) {
                results.push({ success: false, message: `Skipped: Invalid role '${roleName}' for ${firstname} ${surname}.` });
                continue;
            }

            // **MODIFIED:** Pass semId to createAccount
            const result = await createAccount({
                surname,
                firstname,
                email,
                roleId,
                church: churchId
            }, semId);
            results.push(result);
        }

        const successCount = results.filter(r => r.success).length;
        const failCount = results.filter(r => !r.success).length;
        res.status(200).json({
            message: `Batch process complete. ${successCount} accounts created, ${failCount} failed or skipped.`,
            details: results
        });

    } catch (error) {
        console.error('Error processing Excel file:', error);
        res.status(500).json({ message: 'Failed to process file. Please check the file format and try again.' });
    }
});




//ONLY OLD GRC STUDENT
app.post('/submit-application', upload.fields([
    { name: 'formOne', maxCount: 1 },
    { name: 'tor', maxCount: 1 },
    { name: 'admSlip', maxCount: 1 },
    { name: 'lGradeslip', maxCount: 1 },
    { name: 'cor', maxCount: 1 },
    { name: 'recLet1', maxCount: 1 },
    { name: 'valid1', maxCount: 1 },
    { name: 'recLet2', maxCount: 1 },
    { name: 'valid2', maxCount: 1 },
    { name: 'testimony', maxCount: 1 },
    { name: 'housePhotos', maxCount: 1 },
    { name: 'certIndigence', maxCount: 1 },
    // Add the transferee admission slip field here
    { name: 'admSlip-transferee', maxCount: 1 }
]), async (req, res) => {

    if (!currentSem || !currentSem.id) {
        return res.status(400).json({ success: false, message: 'Application period is not yet open.' });
    }

    const { surname, firstname, email, applicant_type, yearLevel, course, schoLevel } = req.body;
    const sem_id = currentSem.id;

    // Logic to convert the schoLevel value
    let scholarshipLevel = null;
    if (schoLevel === '100%') {
        scholarshipLevel = 1;
    } else if (schoLevel === '40%') {
        scholarshipLevel = 2;
    } else {
        // You might want to handle an invalid selection here
        return res.status(400).json({ success: false, message: 'Invalid scholar level selected.' });
    }

    const files = req.files;

    // 1: Validate required documents based on applicant_type
    const requiredFiles = {
        'freshman': ['formOne', 'admSlip'],
        'transferee': ['tor', 'admSlip-transferee'], // Corrected key for transferee
        'old student in GRC': ['lGradeslip', 'cor']
    };

    const commonRequired = ['recLet1', 'valid1', 'recLet2', 'valid2', 'testimony', 'housePhotos', 'certIndigence'];
    const missingCommon = commonRequired.filter(file => !files[file] || files[file].length === 0);

    if (missingCommon.length > 0) {
        return res.status(400).json({ success: false, message: `Missing required documents: ${missingCommon.join(', ')}.` });
    }

    if (requiredFiles[applicant_type]) {
        const typeSpecificMissing = requiredFiles[applicant_type].filter(file => !files[file] || files[file].length === 0);
        if (typeSpecificMissing.length > 0) {
            return res.status(400).json({ success: false, message: `Missing required documents for ${applicant_type}: ${typeSpecificMissing.join(', ')}.` });
        }
    } else {
        return res.status(400).json({ success: false, message: 'Invalid applicant type selected.' });
    }
    
    // Create an object to hold the file buffers, setting unused ones to null
    const fileBuffers = {
        formOne: null,
        tor: null,
        admSlip: null,
        lGradeslip: null,
        cor: null
    };

    if (applicant_type === 'freshman') {
        fileBuffers.formOne = files.formOne ? files.formOne[0].buffer : null;
        fileBuffers.admSlip = files.admSlip ? files.admSlip[0].buffer : null;
    } else if (applicant_type === 'transferee') {
        fileBuffers.tor = files.tor ? files.tor[0].buffer : null;
        fileBuffers.admSlip = files['admSlip-transferee'] ? files['admSlip-transferee'][0].buffer : null;
    } else if (applicant_type === 'old student in GRC') {
        fileBuffers.lGradeslip = files.lGradeslip ? files.lGradeslip[0].buffer : null;
        fileBuffers.cor = files.cor ? files.cor[0].buffer : null;
    }


    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();

        // 2: Check for existing applications in ApplicantInfo table
        const [existingApplicant] = await connection.query(
            'SELECT id FROM ApplicantInfo WHERE surname = ? AND firstname = ?',
            [surname, firstname]
        );
        if (existingApplicant.length > 0) {
            await connection.rollback();
            return res.status(409).json({ success: false, message: 'An application with this name already exists. Please check your submission.' });
        }

        // 3: Check if the applicant is already a scholar for the current semester
        const [existingScholar] = await connection.query(
            'SELECT id FROM Scholar WHERE surname = ? AND firstname = ? AND sem_id = ?',
            [surname, firstname, sem_id]
        );
        if (existingScholar.length > 0) {
            await connection.rollback();
            return res.status(409).json({ success: false, message: 'You are already a scholar for the current semester and do not need to apply.' });
        }

        // 4: Check if the applicant was a scholar in the previous semester
        const prevSemId = sem_id > 1 ? sem_id - 1 : null;
        if (prevSemId) {
            const [existingRecipient] = await connection.query(
                'SELECT id FROM CertificateRecipient WHERE surname = ? AND firstname = ? AND sem_id = ?',
                [surname, firstname, prevSemId]
            );
            if (existingRecipient.length > 0) {
                await connection.rollback();
                return res.status(409).json({ success: false, message: 'You were a scholar in the last semester and are not eligible to apply again.' });
            }
        }

        // 5: If all checks pass, insert the new application
        const insertQuery = `
            INSERT INTO ApplicantInfo (
                surname, firstname, email, applicant_type, yearLevel, course, sem_id, schoLevel,
                formOne, tor, admSlip, lGradeslip, cor,
                recLet1, valid1, recLet2, valid2, testimony, housePhotos, certIndigence
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const safeBuffer = (fileField) => (files[fileField] && files[fileField][0] && files[fileField][0].buffer) || null;

        const queryParams = [
            surname || null,
            firstname || null,
            email || null,
            applicant_type || null,
            yearLevel || null,
            course || null,
            sem_id || null,
            scholarshipLevel || null,
            fileBuffers.formOne ?? null,
            fileBuffers.tor ?? null,
            fileBuffers.admSlip ?? null,
            fileBuffers.lGradeslip ?? null,
            fileBuffers.cor ?? null,
            safeBuffer('recLet1'),
            safeBuffer('valid1'),
            safeBuffer('recLet2'),
            safeBuffer('valid2'),
            safeBuffer('testimony'),
            safeBuffer('housePhotos'),
            safeBuffer('certIndigence')
        ];


        await connection.execute(insertQuery, queryParams);
        await connection.commit();

        res.status(200).json({ success: true, message: 'Application submitted successfully! Your application is now pending review.' });

    } catch (error) {
        if (connection) {
            await connection.rollback();
        }
        console.error('Error submitting application:', error);
        res.status(500).json({ success: false, message: 'Failed to submit application. Please try again later.' });
    } finally {
        if (connection) {
            connection.release();
        }
    }
});

app.post('/api/accept-application/:id', async (req, res) => {
    if (!req.session.loggedIn || req.session.user.role_id !== 6) {
        return res.status(401).json({ message: 'Unauthorized' });
    }

    const applicantId = req.params.id;
    const validatorId = req.session.user.id;
    const conn = await db.getConnection();

    try {
        await conn.beginTransaction();

        const [applicantInfo] = await conn.query(
            'SELECT * FROM ApplicantInfo WHERE id = ? AND assigned_to_validator_id = ? AND status = ?',
            [applicantId, validatorId, 'assigned']
        );

        if (applicantInfo.length === 0) {
            await conn.rollback();
            return res.status(404).json({ message: 'Applicant not found or not assigned to you.' });
        }

        const applicant = applicantInfo[0];
        const semId = currentSem.id;

        // ✅ Check if slots are full
        const [slotRows] = await conn.query(
            'SELECT limit_count, avl_slot FROM ScholarSlotLimit WHERE sem_id = ?',
            [semId]
        );

        if (slotRows.length === 0) {
            await conn.rollback();
            return res.status(400).json({ message: 'Scholar slot limit not configured for this semester.' });
        }

        const { limit_count, avl_slot } = slotRows[0];

        if (limit_count === avl_slot) {
            await conn.rollback();
            return res.status(400).json({ message: 'Cannot accept applicant. All slots are already filled.' });
        }

        // Check for duplicates
        const [existingScholar] = await conn.query(
            'SELECT id FROM Scholar WHERE surname = ? AND firstname = ? AND sem_id = ?',
            [applicant.surname, applicant.firstname, semId]
        );

        if (existingScholar.length > 0) {
            await conn.rollback();
            return res.status(409).json({ message: 'This applicant is already a scholar for the current semester.' });
        }

        const username = `scholar${applicant.surname}`;
        const password = `${applicant.surname}${generateRandomChar('upper')}${generateRandomChar('special')}${generateRandomChar('number')}`;
        const hashedPassword = await bcrypt.hash(password, 10);

        const [userResult] = await conn.query(
            'INSERT INTO Users (username, password, role_id, status, sem_id) VALUES (?, ?, ?, ?, ?)',
            [username, hashedPassword, 2, 'active', semId]
        );

        const newUserId = userResult.insertId;

        await conn.query(
            `INSERT INTO Scholar (
                surname, firstname, email, user_id, dept_id, schoLevel, sem_id, yearLevel, course, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                applicant.surname,
                applicant.firstname,
                applicant.email,
                newUserId,
                1,
                applicant.schoLevel,
                semId,
                applicant.yearLevel,
                applicant.course,
                'active'
            ]
        );

        await conn.query(
            'UPDATE ApplicantInfo SET status = ? WHERE id = ?',
            ['validated', applicantId]
        );

        await conn.query(
            'UPDATE ScholarSlotLimit SET avl_slot = IFNULL(avl_slot, 0) + 1 WHERE sem_id = ?',
            [semId]
        );

        await conn.commit();

        const mailOptions = {
            from: 'scholarshipdept.grc@gmail.com',
            to: applicant.email,
            subject: 'Congratulations! Your Scholarship Application Has Been Accepted',
            html: `
                <p>Dear ${applicant.firstname} ${applicant.surname},</p>
                <p>We are delighted to inform you that your scholarship application has been successfully accepted for the current semester. Congratulations!</p>
                <p>Please use the following credentials to log in to your new scholar account:</p>
                <p><strong>Username:</strong> ${username}</p>
                <p><strong>Password:</strong> ${password}</p>
                <p>For your security, please change your password upon your first login. You are now officially a scholar for the current semester.</p>
                <p>Best regards,</p>
                <p>The Scholarship Team</p>
            `
        };

        transporter.sendMail(mailOptions, (error, info) => {
            if (error) console.error('Error sending acceptance email:', error);
            else console.log('Acceptance email sent:', info.response);
        });

        res.status(200).json({
            success: true,
            message: 'Applicant accepted successfully and an account has been created.'
        });

    } catch (error) {
        if (conn) await conn.rollback();
        console.error('Error accepting applicant:', error);
        res.status(500).json({ success: false, message: 'Database transaction failed.' });
    } finally {
        if (conn) conn.release();
    }
});


function generateRandomChar(type) {
    const chars = {
        'upper': 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
        'special': '!@#$%^&*()_+{}[]:;<>,.?/~`',
        'number': '0123456789'
    };
    const set = chars[type];
    return set[Math.floor(Math.random() * set.length)];
}

//NOT YET DONE
app.post('/api/reject-application/:id', async (req, res) => {
    // Check for user authentication and role
    if (!req.session.loggedIn || req.session.user.role_id !== 6) {
        return res.status(401).json({
            message: 'Unauthorized'
        });
    }

    const { rejectedDocs, rejectionCategory, remarks } = req.body;
    const applicantId = req.params.id;
    const validatorId = req.session.user.id;
    const conn = await db.getConnection();

    // Inappropriate language check
    const badWords = ['gago', 'putangina', 'tangina', 'puta', 'tite'];
    if (badWords.some(word => remarks.toLowerCase().includes(word))) {
        return res.status(400).json({ success: false, message: 'Remarks contain inappropriate language.' });
    }

    try {
        await conn.beginTransaction();

        // 1. Get applicant information and ensure it's assigned to this validator
        const [applicantInfo] = await conn.query(
            'SELECT id, surname, firstname, email FROM ApplicantInfo WHERE id = ? AND assigned_to_validator_id = ?',
            [applicantId, validatorId]
        );

        if (applicantInfo.length === 0) {
            await conn.rollback();
            return res.status(404).json({
                message: 'Applicant not found or not assigned to you.'
            });
        }

        const applicant = applicantInfo[0];

        // 2. Insert into RejectedApplicant table
        await conn.query(
            'INSERT INTO RejectedApplicant (applicant_id, surname, firstname, validator_id, remarks, daterejected, rejection_category, detailed_notes) VALUES (?, ?, ?, ?, ?, NOW(), ?, ?)',
            [applicant.id, applicant.surname, applicant.firstname, validatorId, remarks, rejectionCategory, rejectedDocs.join(', ')]
        );


        // 3. Delete the record from ApplicantInfo
        await conn.query(
            'DELETE FROM ApplicantInfo WHERE id = ?',
            [applicantId]
        );

        await conn.commit();

        // 4. Send rejection email
        let emailText = `Dear ${applicant.firstname} ${applicant.surname},\n\n` +
            `We regret to inform you that your scholarship application has been rejected for the following reason:\n\n`;

        if (rejectionCategory === 'not_qualified_applicant') {
            emailText += `Reason: You do not meet the qualifications for the scholarship. The validator has marked you as "not qualified".\n\n`;
        } else {
            emailText += `The following documents were found to be invalid: ${rejectedDocs.join(', ')}.\n\n`;
            emailText += `Validator's Remarks: ${remarks}\n\n`;
        }

        emailText += `Please address the issues and re-submit your application with the correct and valid documents.`;

        const mailOptions = {
            from: 'scholarshipdept.grc@gmail.com',
            to: applicant.email,
            subject: 'Scholarship Application Rejected',
            text: emailText
        };

        transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
                console.error('Error sending rejection email:', error);
            } else {
                console.log('Rejection email sent:', info.response);
            }
        });

        res.status(200).json({
            success: true,
            message: 'Application rejected successfully and an email has been sent.'
        });

    } catch (error) {
        if (conn) await conn.rollback();
        console.error('Error during applicant rejection transaction:', error);
        res.status(500).json({
            success: false,
            message: 'Internal Server Error.'
        });
    } finally {
        if (conn) conn.release();
    }
});

//RENEWAL
app.post('/submit-renewal', upload.fields([
    { name: 'gradeslip', maxCount: 1 },
    { name: 'coc', maxCount: 1 },
    { name: 'cor', maxCount: 1 }
]), async (req, res) => {
    if (!currentSem || !currentSem.id) {
        return res.status(500).json({ message: 'Server error: No current semester is set.' });
    }

    const sem_id = currentSem.id;

    if (!req.files || !req.files.gradeslip || !req.files.coc || !req.files.cor) {
        return res.status(400).json({ message: 'All three files (gradeslip, COC, and COR) are required.' });
    }

    
    const { surname, firstname, email, yearLevel, course } = req.body;
    
    const gradeslip = req.files.gradeslip[0].buffer;
    const coc = req.files.coc[0].buffer;
    const cor = req.files.cor[0].buffer;

    
    if (!surname || !firstname || !email || !yearLevel || !course) {
        return res.status(400).json({ message: 'All text fields are required.' });
    }

    const namePattern = /^[A-Za-z\s'-]+$/;
    if (!namePattern.test(surname) || !namePattern.test(firstname)) {
        return res.status(400).json({ message: 'Surname and First Name must contain only letters, spaces, hyphens, or apostrophes.' });
    }

    try {
        const checkSql = 'SELECT id FROM RenewalInfo WHERE surname = ? AND firstname = ? AND sem_id = ?';
        const [results] = await db.query(checkSql, [surname, firstname, sem_id]);

        if (results.length > 0) {
            console.log('Duplicate submission attempt for:', surname, firstname, 'in semester', sem_id);
            return res.status(409).json({ message: 'A renewal request for this name has already been submitted for the current semester.' });
        }

        
        const insertSql = 'INSERT INTO RenewalInfo (surname, firstname, email, yearLevel, course, gradeslip, coc, cor, sem_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)';
        
        
        const values = [surname, firstname, email, yearLevel, course, gradeslip, coc, cor, sem_id];

        const [result] = await db.query(insertSql, values);

        console.log('Renewal request record inserted successfully with ID:', result.insertId);
        res.status(200).json({ message: 'Renewal request submitted successfully!', id: result.insertId });

    } catch (err) {
        console.error('Error processing renewal request:', err);
        res.status(500).json({ message: 'Database error.', error: err.message });
    }
});

app.post('/api/accept-renewal/:id', async (req, res) => {
    if (!req.session.loggedIn || req.session.user.role_id !== 6) {
        return res.status(401).json({ message: 'Unauthorized' });
    }

    const applicantId = req.params.id;
    const validatorId = req.session.user.id;
    const conn = await db.getConnection();

    try {
        await conn.beginTransaction();

        const [renewalInfo] = await conn.query(
            'SELECT * FROM RenewalInfo WHERE id = ? AND assigned_to_validator_id = ? AND status = ?',
            [applicantId, validatorId, 'assigned']
        );

        if (renewalInfo.length === 0) {
            await conn.rollback();
            return res.status(404).json({ message: 'Applicant not found or not assigned to you.' });
        }

        const applicant = renewalInfo[0];
        const currentSemId = currentSem.id;
        const previousSemId = currentSemId - 1;

        // ✅ Check if slots are full
        const [slotRows] = await conn.query(
            'SELECT limit_count, avl_slot FROM ScholarSlotLimit WHERE sem_id = ?',
            [currentSemId]
        );

        if (slotRows.length === 0) {
            await conn.rollback();
            return res.status(400).json({ message: 'Scholar slot limit not configured for this semester.' });
        }

        const { limit_count, avl_slot } = slotRows[0];

        if (limit_count === avl_slot) {
            await conn.rollback();
            return res.status(400).json({ message: 'Cannot accept renewal. All slots are already filled.' });
        }

        const [certificateRecipient] = await conn.query(
            'SELECT * FROM CertificateRecipient WHERE surname = ? AND firstname = ? AND sem_id = ?',
            [applicant.surname, applicant.firstname, previousSemId]
        );

        if (certificateRecipient.length === 0) {
            await conn.rollback();
            return res.status(400).json({ message: 'Applicant did not receive a certificate in the previous semester.' });
        }

        const recipient = certificateRecipient[0];

        const [userResult] = await conn.query('SELECT * FROM Users WHERE id = ?', [recipient.user_id]);
        const user = userResult[0];

        const [scholarResult] = await conn.query('SELECT * FROM Scholar WHERE id = ?', [recipient.sch_id]);
        const scholar = scholarResult[0];

        await conn.query('UPDATE Users SET sem_id = ? WHERE id = ?', [currentSemId, user.id]);

        await conn.query(
            'INSERT INTO Scholar (surname, firstname, email, profile, user_id, sem_id, status, schoLevel, yearLevel, course) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [applicant.surname, applicant.firstname, applicant.email, scholar.profile, user.id, currentSemId, 'active', scholar.schoLevel, applicant.yearLevel, applicant.course]
        );

        await conn.query(
            'UPDATE RenewalInfo SET status = ? WHERE id = ?',
            ['validated', applicantId]
        );

        await conn.query(
            'UPDATE ScholarSlotLimit SET avl_slot = IFNULL(avl_slot, 0) + 1 WHERE sem_id = ?',
            [currentSemId]
        );

        await conn.commit();

        const mailOptions = {
            from: 'scholarshipdept.grc@gmail.com',
            to: applicant.email,
            subject: 'Scholarship Renewal Application Accepted',
            text: `Dear ${applicant.firstname} ${applicant.surname},\n\n` +
                `Congratulations! Your scholarship renewal application has been successfully accepted for the current semester.\n\n` +
                `Go to the Scholarship Department in GRC Building and submit your hardcopy next week.\n\n` +
                `You can now log in to your account with the following credentials:\n\n` +
                `Username: ${user.username}\n` +
                `Password: ${user.password}\n\n` + // <--- MODIFIED to include the actual password
                `Best regards,\n` +
                `The Scholarship Team`
        };

        transporter.sendMail(mailOptions, (error, info) => {
            if (error) console.error('Error sending email:', error);
            else console.log('Email sent:', info.response);
        });

        res.status(200).json({
            message: 'Renewal accepted successfully. A new scholar record has been created and an email has been sent.'
        });

    } catch (error) {
        await conn.rollback();
        console.error('Error during renewal acceptance transaction:', error);
        res.status(500).json({ message: 'Internal Server Error.' });
    } finally {
        conn.release();
    }
});


// REJECT RENEWAL
app.post('/api/reject-renewal/:id', async (req, res) => {
    if (!req.session.loggedIn || req.session.user.role_id !== 6) {
        return res.status(401).json({
            message: 'Unauthorized'
        });
    }

    const { rejectedDocs, rejectionCategory, remarks } = req.body;
    const applicantId = req.params.id;
    
    const validatorId = req.session.user.id;
    const conn = await db.getConnection();

    
    const badWords = ['gago', 'putangina', 'tangina', 'puta', 'tite'];

    
    if (badWords.some(word => remarks.toLowerCase().includes(word))) {
        return res.status(400).json({ message: 'Remarks contain inappropriate language.' });
    }

    try {
        await conn.beginTransaction();

        // 1. Get applicant information from RenewalInfo and ensure it's assigned to this validator
        const [renewalInfo] = await conn.query(
            'SELECT id, surname, firstname, email FROM RenewalInfo WHERE id = ? AND assigned_to_validator_id = ?',
            [applicantId, validatorId]
        );

        if (renewalInfo.length === 0) {
            await conn.rollback();
            return res.status(404).json({
                message: 'Applicant not found or not assigned to you.'
            });
        }

        const applicant = renewalInfo[0];

        // 2. Insert into RejectedRenewal table with the correct mapping

        await conn.query(
            'INSERT INTO RejectedRenewal (renewal_id, surname, firstname, validator_id, remarks, daterejected, rejection_category, detailed_notes) VALUES (?, ?, ?, ?, ?, NOW(), ?, ?)',
            [applicant.id, applicant.surname, applicant.firstname, validatorId, remarks, rejectionCategory, rejectedDocs.join(', ')]
        );

        // 3. Delete the record from RenewalInfo
        await conn.query(
            'DELETE FROM RenewalInfo WHERE id = ?',
            [applicantId]
        );

        await conn.commit();

        // 4. Send rejection email
        let emailText = `Dear ${applicant.firstname} ${applicant.surname},\n\n` +
            `Your scholarship renewal application has been rejected for the following reason:\n\n`;

        if (rejectionCategory === 'not_qualified_renewer') {
            emailText += `Reason: You are not a qualified renewer in the system. The validator has marked you as "not qualified".\n\n`;
        } else {
            emailText += `The following documents were found to be invalid: ${rejectedDocs.join(', ')}.\n\n`;
            emailText += `Validator's Remarks: ${remarks}\n\n`;
        }

        emailText += `Please address the issues and re-submit your application with the correct and valid documents. `;

        const mailOptions = {
            from: 'scholarshipdept.grc@gmail.com',
            to: applicant.email,
            subject: 'Scholarship Renewal Application Rejected',
            text: emailText
        };

        transporter.sendMail(mailOptions, (error, info) => {
            if (error) {
                console.error('Error sending rejection email:', error);
            } else {
                console.log('Rejection email sent:', info.response);
            }
        });

        res.status(200).json({
            message: 'Renewal application rejected successfully and an email has been sent to the applicant.'
        });

    } catch (error) {
        await conn.rollback();
        console.error('Error during renewal rejection transaction:', error);
        res.status(500).json({
            message: 'Internal Server Error.'
        });
    } finally {
        conn.release();
    }
});

app.get('/api/get-assigned-request', async (req, res) => {
    if (!req.session.loggedIn || req.session.user.role_id !== 6) {
        return res.status(401).json({
            message: 'Unauthorized'
        });
    }

    const validatorId = req.session.user.id;
    const semId = currentSem ? currentSem.id : null;

    if (!semId) {
        return res.status(500).json({
            message: 'No current semester is set.'
        });
    }

    try {
        // Check for an assigned applicant first
        const [assignedApplicant] = await db.query(
            'SELECT id FROM ApplicantInfo WHERE assigned_to_validator_id = ? AND status = ? AND sem_id = ? LIMIT 1',
            [validatorId, 'assigned', semId]
        );
        if (assignedApplicant.length > 0) {
            return res.status(200).json({
                id: assignedApplicant[0].id,
                type: 'application'
            });
        }

        // If no assigned applicant, check for an assigned renewal
        const [assignedRenewal] = await db.query(
            'SELECT id FROM RenewalInfo WHERE assigned_to_validator_id = ? AND status = ? AND sem_id = ? LIMIT 1',
            [validatorId, 'assigned', semId]
        );
        if (assignedRenewal.length > 0) {
            return res.status(200).json({
                id: assignedRenewal[0].id,
                type: 'renewal'
            });
        }

        // If neither is assigned
        return res.status(200).json({
            message: 'No request currently assigned to you.'
        });

    } catch (error) {
        console.error('Error fetching assigned request:', error);
        res.status(500).json({
            message: 'Internal Server Error.'
        });
    }
});

app.get('/api/assign-next-request', async (req, res) => {
    if (!req.session.loggedIn || req.session.user.role_id !== 6) {
        return res.status(401).json({
            message: 'Unauthorized'
        });
    }

    const validatorId = req.session.user.id;
    const semId = currentSem ? currentSem.id : null;

    if (!semId) {
        return res.status(500).json({
            message: 'No current semester is set.'
        });
    }

    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        // Check for an already assigned request
        const [assignedApplicant] = await conn.query(
            'SELECT id, "application" AS type FROM ApplicantInfo WHERE assigned_to_validator_id = ? AND status = ? AND sem_id = ? LIMIT 1',
            [validatorId, 'assigned', semId]
        );

        let request;
        let tableName;

        if (assignedApplicant.length > 0) {
            request = assignedApplicant[0];
            tableName = 'ApplicantInfo';
        } else {
            const [assignedRenewal] = await conn.query(
                'SELECT id, "renewal" AS type FROM RenewalInfo WHERE assigned_to_validator_id = ? AND status = ? AND sem_id = ? LIMIT 1',
                [validatorId, 'assigned', semId]
            );
            if (assignedRenewal.length > 0) {
                request = assignedRenewal[0];
                tableName = 'RenewalInfo';
            } else {
                // Find and assign a pending applicant first
                const [pendingApplicants] = await conn.query(
                    'SELECT id, "application" AS type FROM ApplicantInfo WHERE status = ? AND sem_id = ? ORDER BY id ASC LIMIT 1 FOR UPDATE',
                    ['pending', semId]
                );

                if (pendingApplicants.length > 0) {
                    request = pendingApplicants[0];
                    tableName = 'ApplicantInfo';
                    await conn.query(
                        'UPDATE ApplicantInfo SET status = ?, assigned_to_validator_id = ? WHERE id = ?',
                        ['assigned', validatorId, request.id]
                    );
                } else {
                    // If no pending applicants, find and assign a pending renewal
                    const [pendingRenewals] = await conn.query(
                        'SELECT id, "renewal" AS type FROM RenewalInfo WHERE status = ? AND sem_id = ? ORDER BY id ASC LIMIT 1 FOR UPDATE',
                        ['pending', semId]
                    );

                    if (pendingRenewals.length === 0) {
                        await conn.commit();
                        return res.status(200).json({
                            message: 'No more pending requests.'
                        });
                    }

                    request = pendingRenewals[0];
                    tableName = 'RenewalInfo';
                    await conn.query(
                        'UPDATE RenewalInfo SET status = ?, assigned_to_validator_id = ? WHERE id = ?',
                        ['assigned', validatorId, request.id]
                    );
                }
            }
        }

        // Calculate the applicant number based on its position in the semester
        // We'll calculate the combined count of applicants and renewals before this ID
        const [applicationCountResult] = await conn.query(
            'SELECT COUNT(*) AS count FROM ApplicantInfo WHERE sem_id = ? AND id <= ?',
            [semId, request.id]
        );
        const [renewalCountResult] = await conn.query(
            'SELECT COUNT(*) AS count FROM RenewalInfo WHERE sem_id = ? AND id <= ?',
            [semId, request.id]
        );
        const applicantNumber = applicationCountResult[0].count + renewalCountResult[0].count;

        await conn.commit();

        res.status(200).json({
            id: request.id,
            type: request.type,
            applicantNumber: applicantNumber
        });

    } catch (error) {
        await conn.rollback();
        console.error('Error assigning request:', error);
        res.status(500).json({
            message: 'Database transaction failed.'
        });
    } finally {
        conn.release();
    }
});

// server.js
app.get('/api/request-details/:id/:type', async (req, res) => {
    if (!req.session.loggedIn || req.session.user.role_id !== 6) {
        return res.status(401).json({
            message: 'Unauthorized'
        });
    }

    const requestId = req.params.id;
    const requestType = req.params.type;
    const validatorId = req.session.user.id;

    let tableName;
    if (requestType === 'application') {
        tableName = 'ApplicantInfo';
    } else if (requestType === 'renewal') {
        tableName = 'RenewalInfo';
    } else {
        return res.status(400).json({
            message: 'Invalid request type.'
        });
    }

    try {
        const [results] = await db.query(
            `SELECT * FROM ${tableName} WHERE id = ? AND assigned_to_validator_id = ?`,
            [requestId, validatorId]
        );

        if (results.length === 0) {
            return res.status(404).json({
                message: 'Request not found or not assigned to you.'
            });
        }

        const requestData = results[0];

        // Function to safely convert binary data to Base64
        const toBase64 = (data) => data ? Buffer.from(data).toString('base64') : null;

        let responseData = {
            id: requestData.id,
            type: requestType,
            surname: requestData.surname,
            firstname: requestData.firstname,
            email: requestData.email,
            yearLevel: requestData.yearLevel,
            course: requestData.course,
            // Add applicant_type to the response
            applicant_type: requestData.applicant_type,
        };

        if (requestType === 'application') {
            responseData = {
                ...responseData,
                formOne: toBase64(requestData.formOne),
                tor: toBase64(requestData.tor),
                admSlip: toBase64(requestData.admSlip),
                lGradeslip: toBase64(requestData.lGradeslip),
                cor: toBase64(requestData.cor),
                recLet1: toBase64(requestData.recLet1),
                valid1: toBase64(requestData.valid1),
                recLet2: toBase64(requestData.recLet2),
                valid2: toBase64(requestData.valid2),
                testimony: toBase64(requestData.testimony),
                housePhotos: toBase64(requestData.housePhotos),
                certIndigence: toBase64(requestData.certIndigence)
            };
        } else if (requestType === 'renewal') {
            responseData = {
                ...responseData,
                gradeslip: toBase64(requestData.gradeslip),
                coc: toBase64(requestData.coc),
                cor: toBase64(requestData.cor)
            };
        }

        res.status(200).json(responseData);
    } catch (error) {
        console.error('Error fetching request details:', error);
        res.status(500).json({
            message: 'Internal Server Error'
        });
    }
});

app.post('/api/release-request', async (req, res) => {
    if (!req.session.loggedIn || req.session.user.role_id !== 6) {
        return res.status(401).json({
            message: 'Unauthorized'
        });
    }

    const {
        id,
        type
    } = req.body;
    const validatorId = req.session.user.id;

    if (!id || !type) {
        return res.status(400).json({
            message: 'Request ID and type are required.'
        });
    }

    let tableName;
    if (type === 'application') {
        tableName = 'ApplicantInfo';
    } else if (type === 'renewal') {
        tableName = 'RenewalInfo';
    } else {
        return res.status(400).json({
            message: 'Invalid request type.'
        });
    }

    try {
        const [result] = await db.execute(
            `UPDATE ${tableName} SET status = ?, assigned_to_validator_id = NULL WHERE id = ? AND assigned_to_validator_id = ? AND status = ?`,
            ['pending', id, validatorId, 'assigned']
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                message: 'Request not found or not assigned to you.'
            });
        }

        res.status(200).json({
            message: 'Request released successfully.'
        });
    } catch (error) {
        console.error('Error releasing request:', error);
        res.status(500).json({
            message: 'Internal Server Error.'
        });
    }
});


app.get('/api/pending-count', async (req, res) => {
    if (!req.session.loggedIn || req.session.user.role_id !== 6) {
        return res.status(401).json({
            message: 'Unauthorized'
        });
    }

    const semId = currentSem ? currentSem.id : null;
    if (!semId) {
        return res.status(200).json({
            count: 0
        });
    }

    try {
        const [applicantsResult] = await db.execute(
            'SELECT COUNT(*) AS count FROM ApplicantInfo WHERE status = ? AND sem_id = ?',
            ['pending', semId]
        );
        const [renewalsResult] = await db.execute(
            'SELECT COUNT(*) AS count FROM RenewalInfo WHERE status = ? AND sem_id = ?',
            ['pending', semId]
        );

        const totalPending = applicantsResult[0].count + renewalsResult[0].count;

        res.status(200).json({
            count: totalPending
        });
    } catch (error) {
        console.error('Error fetching pending requests count:', error);
        res.status(500).json({
            message: 'Internal Server Error'
        });
    }
});

app.get('/api/validator-history', async (req, res) => {
    if (!req.session.loggedIn || req.session.user.role_id !== 6) {
        return res.status(401).json({
            message: 'Unauthorized'
        });
    }

    const validatorId = req.session.user.id;
    const conn = await db.getConnection();

    try {
        // Fetch all validated applications
        const [validatedApplicants] = await conn.query(
            'SELECT surname, firstname, email, yearLevel, course, "Application" AS type FROM ApplicantInfo WHERE assigned_to_validator_id = ? AND status = "validated"',
            [validatorId]
        );

        // Fetch all rejected applications
        const [rejectedApplicants] = await conn.query(
            'SELECT surname, firstname, remarks, daterejected, rejection_category, detailed_notes, "Application" AS type FROM RejectedApplicant WHERE validator_id = ?',
            [validatorId]
        );

        // Fetch all validated renewals
        const [validatedRenewals] = await conn.query(
            'SELECT surname, firstname, email, yearLevel, course, "Renewal" AS type FROM RenewalInfo WHERE assigned_to_validator_id = ? AND status = "validated"',
            [validatorId]
        );

        // Fetch all rejected renewals
        const [rejectedRenewals] = await conn.query(
            'SELECT surname, firstname, remarks, daterejected, rejection_category, detailed_notes, "Renewal" AS type FROM RejectedRenewal WHERE validator_id = ?',
            [validatorId]
        );

        // Combine the results
        const validated = [...validatedApplicants, ...validatedRenewals];
        const rejected = [...rejectedApplicants, ...rejectedRenewals];

        res.status(200).json({
            validated: validated,
            rejected: rejected
        });

    } catch (error) {
        console.error('Error fetching validator history:', error);
        res.status(500).json({
            message: 'Internal Server Error.'
        });
    } finally {
        conn.release();
    }
});
// SUM OF AVBL SLOT
app.get('/avbl-slot', async (req, res) => {
    if (!currentSem) {
        return res.status(400).json({ success: false, message: 'No current semester is set.' });
    }
    const sem_id = currentSem.id;

    try {
        
        const [rows] = await db.query('SELECT limit_count, avl_slot FROM ScholarSlotLimit WHERE sem_id = ?', [sem_id]);

        
        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Scholar slot data not found for the current semester.' });
        }

        
        const data = rows[0];
        const avbl_slot = data.limit_count - data.avl_slot;
        res.json({
            success: true,
            avbl_slot: avbl_slot,
            raw_avl_slot: data.avl_slot,
            limit_count: data.limit_count
        });


    } catch (error) {
        console.error('Error fetching available slots:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch available slots.' });
    }
});

// server.js (ADDITIONS)

// Helper function to count scholars for a given schedule ID and current semester
async function countScholarsForSchedule(schedId, currentSemId) {
    const query = `
        SELECT COUNT(id) AS scholar_count
        FROM Scholar
        WHERE sem_id = ? AND (sched_id = ? OR sched_id_2 = ?)
    `;
    const [results] = await db.query(query, [currentSemId, schedId, schedId]);
    return results[0].scholar_count;
}

// Helper function to get the latest semester ID a scholar was a certificate recipient
async function getLatestRecipientSemId(userId) {
    const query = `
        SELECT sem_id
        FROM CertificateRecipient
        WHERE user_id = ?
        ORDER BY sem_id DESC
        LIMIT 1
    `;
    const [results] = await db.query(query, [userId]);
    return results.length > 0 ? results[0].sem_id : null;
}


// --- ROUTE TO CHECK IF SCHED/DEPT/CHURCH IS MISSING ---
app.get('/check-scholar-setup', async (req, res) => {
    if (!req.session.loggedIn || req.session.user.role_id !== 2 || !currentSem) {
        return res.status(403).json({ needsSetup: false, message: 'Not a logged-in scholar or no current semester.' });
    }

    const userId = req.session.user.id;
    const currentSemId = currentSem.id;

    try {
        const [scholarResults] = await db.query(
            'SELECT sch.id AS scholar_id, sch.dept_id, sch.sched_id, sch.church_id FROM Scholar sch WHERE sch.user_id = ? AND sch.sem_id = ?',
            [userId, currentSemId]
        );

        if (scholarResults.length === 0) {
            // This case shouldn't typically happen if login is successful, but good to handle.
            return res.json({ needsSetup: true, missing: { sched: true, dept: true, church: true } });
        }

        const scholar = scholarResults[0];

        const needsSched = scholar.sched_id === null;
        const needsDept = scholar.dept_id === null;
        const needsChurch = scholar.church_id === null;

        const needsSetup = needsSched || needsDept || needsChurch;

        res.json({
            needsSetup,
            missing: {
                sched: needsSched,
                dept: needsDept,
                church: needsChurch
            },
            scholarId: scholar.scholar_id,
            currentDeptId: scholar.dept_id,
            currentSchedId: scholar.sched_id,
            currentChurchId: scholar.church_id
        });

    } catch (err) {
        console.error('Error checking scholar setup:', err);
        res.status(500).json({ needsSetup: false, message: 'Internal Server Error' });
    }
});


// --- ROUTE TO FETCH DATA FOR THE MODAL ---
app.get('/fetch-setup-data', async (req, res) => {
    if (!req.session.loggedIn || req.session.user.role_id !== 2 || !currentSem) {
        return res.status(403).json({ message: 'Unauthorized' });
    }

    const userId = req.session.user.id;
    const currentSemId = currentSem.id;
    let data = {};

    try {
        // --- 1. SCHED DATA ---
        const [schedules] = await db.query('SELECT id, sched FROM Schedule');
        const wholeDaySchedules = schedules.filter(s => s.id >= 13 && s.id <= 18); // IDs 13-18
        const halfDaySchedules = schedules.filter(s => s.id >= 1 && s.id <= 12); // IDs 1-12

        // Determine availability for whole day (max 4 scholars) and half day (max 6 scholars)
        const wholeDaySlots = 4;
        const halfDaySlots = 6;
        
        // Fetch current scholar assignments for availability check
        const [currentScholarSchedules] = await db.query(
            'SELECT sched_id, sched_id_2 FROM Scholar WHERE sem_id = ? AND (sched_id IS NOT NULL OR sched_id_2 IS NOT NULL)',
            [currentSemId]
        );

        const scheduleCounts = {};
        currentScholarSchedules.forEach(scholar => {
            if (scholar.sched_id) {
                scheduleCounts[scholar.sched_id] = (scheduleCounts[scholar.sched_id] || 0) + 1;
            }
            if (scholar.sched_id_2) {
                scheduleCounts[scholar.sched_id_2] = (scheduleCounts[scholar.sched_id_2] || 0) + 1;
            }
        });

        const schedulesWithAvailability = schedules.map(s => {
            const count = scheduleCounts[s.id] || 0;
            let status = 'Available';
            const limit = s.id >= 13 ? wholeDaySlots : halfDaySlots; // Check whole day or half day limit
            
            if (count >= limit) {
                status = 'Full';
            } else if (count >= limit * 0.75) { // e.g., 75% full
                status = 'Limited';
            }

            return { ...s, status, current_count: count, limit };
        });

        data.wholeDaySchedules = schedulesWithAvailability.filter(s => s.id >= 13 && s.id <= 18);
        data.halfDaySchedules = schedulesWithAvailability.filter(s => s.id >= 1 && s.id <= 12);

        // --- 2. DEPARTMENT DATA ---
        const [deptLimitResults] = await db.query(`
            SELECT 
                d.id AS dept_id, 
                d.deptname, 
                dsl.limit_count
            FROM Department d
            LEFT JOIN DeptSlotLimit dsl ON d.id = dsl.dept_id AND dsl.sem_id = ?
        `, [currentSemId]);

        const [scholarCounts] = await db.query(
            'SELECT dept_id, COUNT(id) AS scholar_count FROM Scholar WHERE sem_id = ? AND dept_id IS NOT NULL GROUP BY dept_id',
            [currentSemId]
        );

        const scholarCountsMap = scholarCounts.reduce((acc, curr) => {
            acc[curr.dept_id] = curr.scholar_count;
            return acc;
        }, {});

        const departmentsWithAvailability = deptLimitResults.map(d => {
            const currentCount = scholarCountsMap[d.dept_id] || 0;
            const limit = d.deptname.toLowerCase() === 'housekeeping' ? Infinity : (d.limit_count || Infinity); // Housekeeping has no limit

            let status = 'Available';
            if (currentCount >= limit) {
                status = 'Full';
            } else if (limit !== Infinity && currentCount >= limit * 0.75) {
                status = 'Limited';
            }

            return {
                id: d.dept_id,
                deptname: d.deptname,
                status,
                limit: limit === Infinity ? 'N/A' : limit,
                current_count: currentCount,
                isHousekeeping: d.deptname.toLowerCase() === 'housekeeping'
            };
        });
        
        data.departments = departmentsWithAvailability;
        
        // Check for Housekeeping lock condition
        const [scholarInfo] = await db.query(
            'SELECT id FROM Scholar WHERE user_id = ? AND sem_id = ?',
            [userId, currentSemId]
        );
        const scholarId = scholarInfo.length > 0 ? scholarInfo[0].id : null;
        
        let isLockedToHousekeeping = false;
        let housekeepingDeptId = data.departments.find(d => d.isHousekeeping)?.id;

        if (scholarId) {
             const latestRecipientSemId = await getLatestRecipientSemId(userId);

             if (latestRecipientSemId !== null) {
                const [recipientInfo] = await db.query(
                    'SELECT renew FROM CertificateRecipient WHERE user_id = ? AND sem_id = ?',
                    [userId, latestRecipientSemId]
                );

                if (recipientInfo.length > 0 && recipientInfo[0].renew === 0) {
                    isLockedToHousekeeping = true;
                }
             }
        }
        
        data.housekeepingLock = {
            isLocked: isLockedToHousekeeping,
            deptId: housekeepingDeptId
        };
        
        // --- 3. CHURCH DATA ---
        const [churches] = await db.query('SELECT id, chname FROM Church');
        data.churches = churches;

        res.json(data);

    } catch (err) {
        console.error('Error fetching setup data:', err);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});


// --- ROUTE TO SUBMIT SCHOLAR SETUP DATA ---
app.post('/update-scholar-setup', async (req, res) => {
    if (!req.session.loggedIn || req.session.user.role_id !== 2 || !currentSem) {
        // Must return JSON if client expects it to be parsed
        return res.status(403).json({ message: 'Unauthorized', isNewSetup: false });
    }

    const { scholarId, new_sched_id, new_sched_id_2, new_dept_id, new_church_id } = req.body;
    const userId = req.session.user.id;
    const currentSemId = currentSem.id;

    // 1. Check current scholar data for setup status
    const [scholarResults] = await db.query(
        'SELECT sched_id, dept_id, church_id FROM Scholar WHERE id = ? AND user_id = ? AND sem_id = ?',
        [scholarId, userId, currentSemId]
    );

    if (scholarResults.length === 0) {
        return res.status(403).json({ message: 'Invalid scholar ID or session mismatch.', isNewSetup: false });
    }

    const scholar = scholarResults[0];
    
    // Determine if ANY of the setup fields were previously NULL (meaning this submission is a new setup)
    const wasNewSetup = scholar.sched_id === null || scholar.dept_id === null || scholar.church_id === null;

    // Start building the query
    let updateFields = [];
    let updateValues = [];
    let isUpdating = false; // Flag to check if any field is actually being updated now

    // Only update fields that are currently NULL OR a new value was provided
    if (scholar.sched_id === null && new_sched_id !== undefined) {
        updateFields.push('sched_id = ?');
        updateValues.push(new_sched_id);
        if (new_sched_id_2 !== undefined) {
            updateFields.push('sched_id_2 = ?');
            updateValues.push(new_sched_id_2);
        } else {
            // Handle case where sched_id is set, but sched_id_2 is needed (half day)
            updateFields.push('sched_id_2 = NULL');
        }
        isUpdating = true;
    }

    if (scholar.dept_id === null && new_dept_id !== undefined) {
        // NOTE: A robust check for department capacity should be here,
        // but for now, we rely on the logic in the client to prevent selection.
        updateFields.push('dept_id = ?');
        updateValues.push(new_dept_id);
        isUpdating = true;
    }

    if (scholar.church_id === null && new_church_id !== undefined) {
        updateFields.push('church_id = ?');
        updateValues.push(new_church_id);
        isUpdating = true;
    }
    
    // If no fields to update, return success as nothing was needed or provided.
    if (!isUpdating) {
        // Return success, but specify that QR generation is NOT needed
        return res.json({ 
            message: 'Setup is complete. No new data was required or provided.', 
            isNewSetup: false, 
            scholarId: scholarId 
        });
    }

    const updateQuery = `UPDATE Scholar SET ${updateFields.join(', ')} WHERE id = ?`;
    updateValues.push(scholarId);

    try {
        await db.query(updateQuery, updateValues);
        
        // ** IMPORTANT: The success response must be JSON and contain the flags the client needs **
        res.json({
            message: 'Scholar setup successfully updated!',
            // We tell the client to generate QR code ONLY if this was the first time filling in one of the fields
            isNewSetup: wasNewSetup, 
            scholarId: scholarId 
        });

    } catch (err) {
        console.error('Error updating scholar setup:', err);
        res.status(500).json({ 
            message: 'Failed to update scholar setup. Please try again.', 
            isNewSetup: false 
        });
    }
});

// --- ROUTE TO GENERATE AND SAVE QR CODE ---
app.post('/generate-qrcode', async (req, res) => {
    // 1. Define variables from request and session (Fixes "scholarId is not defined")
    if (!req.session.loggedIn || req.session.user.role_id !== 2 || !currentSem) {
        return res.status(403).json({ message: 'Unauthorized' });
    }

    const { scholarId } = req.body;
    const userId = req.session.user.id;
    
    // WARNING: Assuming 'currentSem' is globally available or defined in your server setup.
    if (!currentSem || !currentSem.id) {
        console.error('[QR ERROR] currentSem or currentSem.id is not defined on server.');
        return res.status(500).json({ message: 'Server configuration error: current semester not set.' });
    }
    const currentSemId = currentSem.id;

    // IMPORTANT LOGGING: Check what scholar ID was received
    console.log(`[QR LOG] Attempting to generate QR for Scholar ID: ${scholarId}, User ID: ${userId}, Sem ID: ${currentSemId}`); 

    if (!scholarId) {
        console.error('[QR ERROR] scholarId is missing from request body.');
        return res.status(400).json({ message: 'Missing scholarId in request body.' });
    }

    try {
        // 2. Validate and fetch required scholar data
        const [scholarResults] = await db.query(
            // Fetch ALL data needed to generate the QR code content
            'SELECT sch.id, sch.user_id, sch.firstname, sch.surname, sch.schoLevel FROM Scholar sch WHERE sch.id = ? AND sch.user_id = ? AND sch.sem_id = ?',
            [scholarId, userId, currentSemId]
        );

        if (scholarResults.length === 0) {
            console.warn(`[QR LOG] Scholar record not found for ID: ${scholarId}`);
            return res.status(404).json({ message: 'Scholar record not found or session mismatch.' });
        }

        const scholar = scholarResults[0];

        // 3. Construct the data for the QR Code
        const qrData = JSON.stringify({
            id: scholar.id,
            user: scholar.user_id,
            name: `${scholar.firstname} ${scholar.surname}`,
            sem: currentSemId,
            level: scholar.schoLevel,
        });
        
        console.log(`[QR LOG] QR Data String: ${qrData}`);

        // 4. Generate the QR Code as a Data URL (base64 string)
        const qrcodeDataUrl = await QRCode.toDataURL(qrData, {
            errorCorrectionLevel: 'H',
            type: 'image/png',
            margin: 1,
            scale: 8
        });

        console.log(`[QR LOG] Generated Base64 URL Length: ${qrcodeDataUrl.length}`);
        
        // 5. Save the Data URL to the Scholar table
        const updateQuery = 'UPDATE Scholar SET qrcode = ? WHERE id = ?';
        await db.query(updateQuery, [qrcodeDataUrl, scholarId]);
        
        console.log(`[QR LOG] Database update successful for Scholar ID: ${scholarId}`);

        res.json({
            message: 'QR Code successfully generated and saved!',
            qrcode: qrcodeDataUrl
        });

    } catch (err) {
        // CATCH ANY ERRORS DURING GENERATION OR DB INSERTION
        console.error(`[QR ERROR] Failed to generate or save QR code for Scholar ID ${scholarId}:`, err);
        res.status(500).json({ message: 'Failed to generate QR code.' });
    }
});

// Function to format a Date object or string into a specific format (e.g., MM/DD/YYYY)
function formatDate(dateString) {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    if (isNaN(date)) return 'N/A';
    // Format as 'Month DD, YYYY'
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

// --- ROUTE TO FETCH ALL SCHOLAR CARD DATA ---
app.get('/get-scholar-card-data', async (req, res) => {
    if (!req.session.loggedIn || req.session.user.role_id !== 2 || !currentSem) {
        return res.status(403).json({ message: 'Unauthorized or no active semester.' });
    }

    const userId = req.session.user.id;
    const currentSemId = currentSem.id;

    try {
        // Query to fetch Scholar, Department, Church, Schedule, and Semester data in one go
        const query = `
            SELECT
                sch.firstname, sch.surname, sch.profile, sch.qrcode, sch.sched_id, sch.sched_id_2,
                sem.semname, sem.datestart,
                dept.deptname,
                ch.chname,
                s1.sched AS sched1_time,
                s2.sched AS sched2_time
            FROM
                Scholar sch
            LEFT JOIN
                Semester sem ON sch.sem_id = sem.id
            LEFT JOIN
                Department dept ON sch.dept_id = dept.id
            LEFT JOIN
                Church ch ON sch.church_id = ch.id
            LEFT JOIN
                Schedule s1 ON sch.sched_id = s1.id
            LEFT JOIN
                Schedule s2 ON sch.sched_id_2 = s2.id
            WHERE
                sch.user_id = ? AND sch.sem_id = ?;
        `;

        const [results] = await db.query(query, [userId, currentSemId]);

        if (results.length === 0) {
            return res.status(404).json({ message: 'Scholar data not found for the current semester.' });
        }

        const data = results[0];

        // 1. Name and Role
        const name = `${data.firstname} ${data.surname}`;
        const role = 'Scholar';
        const semester = `${data.semname} (${formatDate(data.datestart)})`;

        // 2. Schedule and Type
        let scheduleType;
        let schedule;
        if (data.sched_id && data.sched_id_2) {
            scheduleType = 'Half Day';
            // Schedule shows both sched_id and sched_id_2
            schedule = `${data.sched1_time}, ${data.sched2_time}`;
        } else if (data.sched_id && !data.sched_id_2) {
            scheduleType = 'Whole Day';
            // Schedule shows only sched_id
            schedule = data.sched1_time;
        } else {
            scheduleType = 'Not Set';
            schedule = 'TBA';
        }
        
        // 3. Department
        const department = data.deptname || 'Not Set';

        // 4. Church
        const church = data.chname || 'Not Set';

        // 5. QR Code & Profile Picture (Pass data as is)
        const qrcode = data.qrcode; // base64 URL string
        // Profile is a Buffer, needs to be handled on the client side
        const profile = data.profile ? data.profile.toString('base64') : null;


        res.json({
            name,
            role,
            semester,
            scheduleType,
            schedule,
            department,
            church,
            qrcode,
            profile // base64 encoded profile picture
        });

    } catch (err) {
        console.error('Error fetching scholar card data:', err);
        res.status(500).json({ message: 'Internal server error while fetching card data.' });
    }
});


//scanner


// Setting the default timezone for dayjs to Asia/Manila
dayjs.tz.setDefault('Asia/Manila');

// --- NEW UTILITY FUNCTION: Check if the scholar has ANY schedule for the current day ---
function checkScheduleDayMatch(sched_id_1, sched_id_2) {
    const nowManila = dayjs().tz('Asia/Manila');
    const currentDay = nowManila.format('dddd'); // e.g., 'Monday'

    // Map all existing schedule IDs to their corresponding day
    const dayMap = { 
        1: 'Monday', 2: 'Monday', 13: 'Monday', 3: 'Tuesday', 4: 'Tuesday', 14: 'Tuesday', 
        5: 'Wednesday', 6: 'Wednesday', 15: 'Wednesday', 7: 'Thursday', 8: 'Thursday', 16: 'Thursday', 
        9: 'Friday', 10: 'Friday', 17: 'Friday', 11: 'Saturday', 12: 'Saturday', 18: 'Saturday' 
    };

    const checkSingleDay = (id) => {
        if (!id) return false;
        return dayMap[id] === currentDay;
    };

    // Return true if either schedule ID matches the current day
    return checkSingleDay(sched_id_1) || checkSingleDay(sched_id_2);
}

// --- UTILITY FUNCTION: Determine Schedule Match (No Change) ---
function checkScheduleMatch(sched_id, sched_id_2, dbSchedules) {
    // 1. Get current time in Manila
    const nowManila = dayjs().tz('Asia/Manila');
    const currentDay = nowManila.format('dddd'); // e.g., 'Monday'
    const currentTime = nowManila.hour() * 60 + nowManila.minute(); // minutes from midnight

    let isMatch = false;

    // Helper to check if a specific schedule ID is valid for the current day and time
    const checkSingleSchedule = (id) => {
        if (!id) return false;

        let startTime, endTime;
        let dayMatch = false;
        
        // DAY CHECKING
        const isOddHalf = [1, 3, 5, 7, 9, 11].includes(id);
        const isEvenHalf = [2, 4, 6, 8, 10, 12].includes(id);
        const isWhole = [13, 14, 15, 16, 17, 18].includes(id);

        if (isWhole) { // WHOLE DAY Sched_ids (13-18)
            startTime = 8 * 60; // 8:00 AM
            endTime = 17 * 60; // 5:00 PM
            dayMatch = 
                (id === 13 && currentDay === 'Monday') ||
                (id === 14 && currentDay === 'Tuesday') ||
                (id === 15 && currentDay === 'Wednesday') ||
                (id === 16 && currentDay === 'Thursday') ||
                (id === 17 && currentDay === 'Friday') ||
                (id === 18 && currentDay === 'Saturday');
        } else if (isOddHalf) { // Morning HALF DAY Sched_ids (odd numbers)
            startTime = 8 * 60; // 8:00 AM
            endTime = 12 * 60; // 12:00 PM
            dayMatch = 
                (id === 1 && currentDay === 'Monday') ||
                (id === 3 && currentDay === 'Tuesday') ||
                (id === 5 && currentDay === 'Wednesday') ||
                (id === 7 && currentDay === 'Thursday') ||
                (id === 9 && currentDay === 'Friday') ||
                (id === 11 && currentDay === 'Saturday');
        } else if (isEvenHalf) { // Afternoon HALF DAY Sched_ids (even numbers)
            startTime = 13 * 60; // 1:00 PM
            endTime = 17 * 60; // 5:00 PM
            dayMatch = 
                (id === 2 && currentDay === 'Monday') ||
                (id === 4 && currentDay === 'Tuesday') ||
                (id === 6 && currentDay === 'Wednesday') ||
                (id === 8 && currentDay === 'Thursday') ||
                (id === 10 && currentDay === 'Friday') ||
                (id === 12 && currentDay === 'Saturday');
        } else {
            return false; // Invalid or unhandled sched_id
        }

        // TIME CHECKING
        const timeMatch = (currentTime >= startTime && currentTime < endTime);
        
        return dayMatch && timeMatch;
    };

    // HALF DAY CONDITION: Only one of the sched_id or sched_id_2 needs to match
    if (sched_id && sched_id_2) {
        isMatch = checkSingleSchedule(sched_id) || checkSingleSchedule(sched_id_2);
    } 
    // WHOLE DAY/Single Schedule
    else if (sched_id) {
        isMatch = checkSingleSchedule(sched_id);
    }
    
    return isMatch;
}

// --- UTILITY FUNCTION: Determine Status and Adjusted Times (FROM PREVIOUS CORRECTION) ---
function determineAdjustedTimes(sched_id_1, sched_id_2, timeInStr, timeOutStr) {
    // ... (This function remains unchanged as it was already correct)
    const timeIn = dayjs.tz(`2000-01-01 ${timeInStr}`, 'Asia/Manila');
    const timeInMinutes = timeIn.hour() * 60 + timeIn.minute();
    
    let status = 'Present';
    let adjustedTimeIn = timeInStr;
    let adjustedTimeOut = timeOutStr; 

    // Define standard times in minutes from midnight
    const AM_START_MIN = 8 * 60;    // 8:00 AM
    const AM_LATE_MIN = 8 * 60 + 15;  // 8:15 AM
    const AM_END_MIN = 12 * 60;    // 12:00 PM
    const AM_END_GRACE_MIN = 12 * 60 + 15; // 12:15 PM

    const PM_START_MIN = 13 * 60;   // 1:00 PM (13:00)
    const PM_LATE_MIN = 13 * 60 + 15; // 1:15 PM (13:15)
    const PM_END_MIN = 17 * 60;    // 5:00 PM (17:00)
    const PM_END_GRACE_MIN = 17 * 60 + 15; // 5:15 PM (17:15)

    // Identify Schedule Types
    const wholeDayIds = [13, 14, 15, 16, 17, 18];
    const amIds = [1, 3, 5, 7, 9, 11]; 
    const pmIds = [2, 4, 6, 8, 10, 12]; 
    
    const isWholeDay = wholeDayIds.includes(sched_id_1) || wholeDayIds.includes(sched_id_2);
    const hasAMSchedule = isWholeDay || amIds.includes(sched_id_1) || amIds.includes(sched_id_2);
    const hasPMSchedule = isWholeDay || pmIds.includes(sched_id_1) || pmIds.includes(sched_id_2);

    /* --- TIME IN LOGIC --- */

    if (hasAMSchedule) {
        if (timeInMinutes > AM_LATE_MIN) {
            status = 'Late';
        } else if (timeInMinutes >= AM_START_MIN || timeInMinutes < AM_START_MIN) { 
            adjustedTimeIn = '08:00:00';
        } 
    } 
    
    if (hasPMSchedule && !hasAMSchedule) { 
          const timeIn = dayjs.tz(`2000-01-01 ${timeInStr}`, 'Asia/Manila');
          const timeInMinutes = timeIn.hour() * 60 + timeIn.minute();
          
          if (timeInMinutes > PM_LATE_MIN) {
            status = 'Late';
        } else if (timeInMinutes >= PM_START_MIN || timeInMinutes < PM_START_MIN) {
            adjustedTimeIn = '13:00:00';
        }
    }


    /* --- TIME OUT LOGIC (Only applies if timeOutStr is provided) --- */
    if (timeOutStr) {
        const timeOut = dayjs.tz(`2000-01-01 ${timeOutStr}`, 'Asia/Manila');
        const timeOutMinutes = timeOut.hour() * 60 + timeOut.minute();

        // 1. Check for Morning Time Out (Half Day AM)
        if (hasAMSchedule && !hasPMSchedule) { // Pure AM Half-Day
            if (timeOutMinutes > AM_END_MIN && timeOutMinutes <= AM_END_GRACE_MIN) {
                adjustedTimeOut = '12:00:00';
            } else if (timeOutMinutes < AM_END_MIN) {
                adjustedTimeOut = timeOutStr; 
            } else if (timeOutMinutes > AM_END_GRACE_MIN) {
                adjustedTimeOut = '12:00:00';
            }
        }
        
        // 2. Check for Afternoon Time Out (Half Day PM or Whole Day)
        if (hasPMSchedule) { 
            if (timeOutMinutes > PM_END_MIN && timeOutMinutes <= PM_END_GRACE_MIN) {
                adjustedTimeOut = '17:00:00';
            } else if (timeOutMinutes < PM_END_MIN) {
                adjustedTimeOut = timeOutStr; 
            } else if (timeOutMinutes > PM_END_GRACE_MIN) {
                 adjustedTimeOut = '17:00:00';
            }
        }
    }

    return { status, adjustedTimeIn, adjustedTimeOut };
}

// --- UTILITY FUNCTION: Calculate Total Duty Minutes for ONE Log Entry (CRITICAL UPDATE: Returns Minutes) ---
function calculateTotalDuty(adjustedTimeInStr, adjustedTimeOutStr, isWholeDay) {
    // ... (This function remains unchanged as it was already correct)
    if (!adjustedTimeInStr || !adjustedTimeOutStr) return 0;

    const fixedDate = '2000-01-01'; 
    let timeIn = dayjs.tz(`${fixedDate} ${adjustedTimeInStr}`, 'Asia/Manila');
    let timeOut = dayjs.tz(`${fixedDate} ${adjustedTimeOutStr}`, 'Asia/Manila');
    
    if (timeOut.isBefore(timeIn) || timeOut.isSame(timeIn)) return 0; 

    let totalMinutes = timeOut.diff(timeIn, 'minute');

    // BREAK TIME EXCLUSION: 12:00 PM to 1:00 PM (60 minutes) - Only for Whole Day schedules
    if (isWholeDay) {
        const breakStart = dayjs.tz(`${fixedDate} 12:00:00`, 'Asia/Manila');
        const breakEnd = dayjs.tz(`${fixedDate} 13:00:00`, 'Asia/Manila');

        // Check if the duty period covers the break time
        if (timeIn.isBefore(breakEnd) && timeOut.isAfter(breakStart)) {
            const overlapStart = dayjs.max(timeIn, breakStart);
            const overlapEnd = dayjs.min(timeOut, breakEnd);
            
            if (overlapEnd.isAfter(overlapStart)) {
                const breakOverlapMinutes = overlapEnd.diff(overlapStart, 'minute');
                totalMinutes -= breakOverlapMinutes;
            }
        }
    }

    // IMPORTANT CHANGE: Return the total minutes worked (INT)
    return Math.floor(totalMinutes); 
}

// --- UTILITY FUNCTION: Calculate Total Time Duty for Semester (SUM) (CRITICAL UPDATE: Sums Minutes, Floors Hours) ---
async function calculateTotalTimeDuty(scholarId, semId, connection) {
    // ... (This function remains unchanged as it was already correct)
    // 1. Select the SUM of all duty minutes (stored in the 'totalduty' column)
    const [result] = await connection.query(
        'SELECT SUM(totalduty) AS total_duty_minutes FROM GratisLogs WHERE scholar_id = ? AND sem_id = ?',
        [scholarId, semId]
    );
    
    const totalMinutes = result[0].total_duty_minutes || 0;
    
    // 2. Divide the total minutes by 60 and floor it to get the total hours for the semester
    // This preserves cumulative fraction of an hour (e.g., 60 mins -> 1 hour)
    return Math.floor(totalMinutes / 60); 
}


// --- CRON JOB FUNCTION: Absent Logic Implementation (UPDATED) ---
async function checkAndMarkAbsent(db, connection) {
    // ... (This function remains unchanged as it was already correct)
    const nowManila = dayjs().tz('Asia/Manila');
    const gratis_date = nowManila.format('YYYY-MM-DD');
    const currentDayOfWeek = nowManila.format('dddd'); 
    const currentTime = nowManila.hour() * 60 + nowManila.minute(); 

    console.log(`[ABSENT CHECK] Running check for ${gratis_date} at ${nowManila.format('HH:mm:ss')}`);

    // AM Half Day: Check past 1:00 PM (780 min)
    let checkMorningShift = currentTime >= (13 * 60); 
    // PM Half Day/Whole Day: Check past 6:00 PM (1080 min)
    let checkAfternoonShift = currentTime >= (18 * 60); 
    
    // Schedule IDs for lookup
    const amIds = [1, 3, 5, 7, 9, 11]; // Half-day AM
    const pmIds = [2, 4, 6, 8, 10, 12]; // Half-day PM
    const wholeDayIds = [13, 14, 15, 16, 17, 18]; // Whole-day

    // 1. Get all logs for today that have a time_in but no time_out, and are not already marked 'Absent'
    const [logsToCheck] = await connection.query(`
        SELECT g.id, g.scholar_id, g.sem_id, g.time_in, s.sched_id, s.sched_id_2
        FROM GratisLogs g
        JOIN Scholar s ON g.scholar_id = s.id
        WHERE g.gratis_date = ? AND g.time_in IS NOT NULL AND g.time_out IS NULL AND g.status != 'Absent'
    `, [gratis_date]);

    if (logsToCheck.length === 0) {
        console.log('[ABSENT CHECK] No open logs found to check.');
        return;
    }

    // Map schedule ID to the day of the week
    const dayMap = { 
        1: 'Monday', 2: 'Monday', 13: 'Monday', 3: 'Tuesday', 4: 'Tuesday', 14: 'Tuesday', 
        5: 'Wednesday', 6: 'Wednesday', 15: 'Wednesday', 7: 'Thursday', 8: 'Thursday', 16: 'Thursday', 
        9: 'Friday', 10: 'Friday', 17: 'Friday', 11: 'Saturday', 12: 'Saturday', 18: 'Saturday' 
    };

    for (const log of logsToCheck) {
        const { id: logId, scholar_id, time_in, sched_id, sched_id_2 } = log;

        const checkDayMatch = (id) => dayMap[id] === currentDayOfWeek;

        // Did they have a morning-only schedule that ends at 12:00 PM?
        const hasMorningOnlyShift = 
            (checkDayMatch(sched_id) && amIds.includes(sched_id)) || 
            (checkDayMatch(sched_id_2) && amIds.includes(sched_id_2));

        // Did they have a schedule that ends at 5:00 PM (PM Half or Whole Day)?
        const hasAfternoonEndShift = 
            (checkDayMatch(sched_id) && (pmIds.includes(sched_id) || wholeDayIds.includes(sched_id))) || 
            (checkDayMatch(sched_id_2) && (pmIds.includes(sched_id_2) || wholeDayIds.includes(sched_id_2)));

        let isAbsent = false;

        if (checkMorningShift && hasMorningOnlyShift) {
            isAbsent = true; 
        } 
        
        if (checkAfternoonShift && hasAfternoonEndShift) {
            isAbsent = true;
        }

        // Apply Absent status
        if (isAbsent) {
            await connection.query(
                `UPDATE GratisLogs SET status = 'Absent', totalduty = 0, time_out = NULL WHERE id = ?`,
                [logId]
            );
            console.log(`[ABSENT MARKED] Log ID ${logId} for Scholar ${scholar_id} marked as Absent.`);
        }
    }
    console.log('[ABSENT CHECK] Finished daily absence check.');
}

// 2. Start the cron jobs when the server starts (UPDATED)

// Cron job 1: Check Morning shifts (runs at 1:00 PM, 13:00)
cron.schedule('0 13 * * *', async () => {
    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction(); 
        await checkAndMarkAbsent(db, connection);
        await connection.commit();
    } catch (error) {
        console.error('CRON JOB ERROR (1:00 PM):', error);
        if (connection) await connection.rollback();
    } finally {
        if (connection) connection.release();
    }
}, {
    scheduled: true,
    timezone: "Asia/Manila"
});

// Cron job 2: Check Afternoon/Whole Day shifts (runs at 6:00 PM, 18:00)
cron.schedule('0 18 * * *', async () => {
    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction(); 
        await checkAndMarkAbsent(db, connection);
        await connection.commit();
    } catch (error) {
        console.error('CRON JOB ERROR (6:00 PM):', error);
        if (connection) await connection.rollback();
    } finally {
        if (connection) connection.release();
    }
}, {
    scheduled: true,
    timezone: "Asia/Manila"
});


// --- ROUTE TO RECEIVE SCANNED QR CODE DATA AND DISPLAY INFO (UPDATED WITH SEM CHECK) ---
app.post('/scan-qr-code', async (req, res) => {
    // Check if the current semester data is loaded
    if (!currentSem || !currentSem.id) {
         return res.status(503).json({ message: 'System error: Current active semester is not yet loaded or set.' });
    }
    const currentSemId = currentSem.id; 

    const { qrData } = req.body;
    if (!qrData) return res.status(400).json({ message: 'No QR data received.' });

    try {
        const scholarInfo = JSON.parse(qrData);
        const scholar_id = scholarInfo.id;
        const gratis_date = dayjs().tz('Asia/Manila').format('YYYY-MM-DD'); 

        // 1. Fetch Scholar, Semester, Dept, Church, and Schedule details
        const sql = `
             SELECT 
                 s.id AS scholar_id, s.surname, s.firstname, s.profile, s.sched_id, s.sched_id_2,
                 sem.semname, sem.datestart,
                 dept.deptname,
                 ch.chname,
                 sch1.sched AS sched1_desc,
                 sch2.sched AS sched2_desc
             FROM Scholar s
             LEFT JOIN Semester sem ON s.sem_id = sem.id
             LEFT JOIN Department dept ON s.dept_id = dept.id
             LEFT JOIN Church ch ON s.church_id = ch.id
             LEFT JOIN Schedule sch1 ON s.sched_id = sch1.id
             LEFT JOIN Schedule sch2 ON s.sched_id_2 = sch2.id
             WHERE s.id = ? AND s.sem_id = ?`; // <-- CRITICAL: Enforces sem_id match

        // Use the currentSemId from the server
        const [rows] = await db.query(sql, [scholar_id, currentSemId]); 

        if (rows.length === 0) {
            return res.status(404).json({ 
                message: 'Scholar not found, or they are not enrolled in the current active semester.',
                scheduleMatch: false 
            });
        }

        const scholar = rows[0];

        // *** DAY-OF-WEEK CHECK ***
        const scheduleDayMatch = checkScheduleDayMatch(scholar.sched_id, scholar.sched_id_2);
        
        if (!scheduleDayMatch) {
            return res.status(403).json({ 
                message: `Cannot record attendance. The scholar does not have a scheduled duty on ${dayjs().tz('Asia/Manila').format('dddd')}.`,
                scheduleMatch: false 
            });
        }
        // *** END DAY CHECK ***

        // 2. Determine Schedule Type and Details
        const scheduleType = scholar.sched_id && scholar.sched_id_2 ? 'HALF DAY' : 'WHOLE DAY';
        const scheduleDetails = scholar.sched_id_2 
            ? `${scholar.sched1_desc} / ${scholar.sched2_desc}` 
            : scholar.sched1_desc || 'No Schedule Set';
        
        // 3. Fetch all schedules for comparison 
        const [scheduleRows] = await db.query('SELECT * FROM Schedule');
        const dbSchedules = scheduleRows.reduce((map, obj) => {
            map[obj.id] = obj.sched;
            return map;
        }, {});
        
        // 4. Check Schedule Match (This checks the time window)
        const scheduleMatch = checkScheduleMatch(scholar.sched_id, scholar.sched_id_2, dbSchedules);

        // 5. Determine if TIME IN or TIME OUT is needed
        const [logRows] = await db.query(
            'SELECT id, time_in, time_out FROM GratisLogs WHERE scholar_id = ? AND gratis_date = ? ORDER BY id DESC LIMIT 1',
            [scholar_id, gratis_date]
        );

        let requestAction = 'TIME IN';
        let log_id_to_update = null;

        if (logRows.length > 0) {
            const latestLog = logRows[0];
            if (latestLog.time_in && !latestLog.time_out) {
                requestAction = 'TIME OUT';
                log_id_to_update = latestLog.id;
            }
        }
        
        // 6. Assemble the data for the client (frontend modal)
        const modalData = {
            scholar_id: scholar.scholar_id,
            log_id_to_update: log_id_to_update,
            requestAction: requestAction,
            scheduleMatch: scheduleMatch, 
            
            // Display data
            name: `${scholar.firstname} ${scholar.surname}`,
            role: 'Scholar', 
            profile: scholar.profile ? scholar.profile.toString('base64') : null,
            semname: scholar.semname,
            datestart: dayjs(scholar.datestart).format('MMM D, YYYY'),
            deptname: scholar.deptname,
            chname: scholar.chname,
            scheduleType: scheduleType,
            scheduleDetails: scheduleDetails,
        };

        return res.json({
            message: `Scholar data prepared for ${requestAction} action.`,
            data: modalData
        });

    } catch (error) {
        console.error('Error in /scan-qr-code:', error);
        return res.status(500).json({ message: 'Server error during data retrieval.' });
    }
});



// --- ROUTE TO RECORD ATTENDANCE (UPDATED WITH SEM CHECK) ---
app.post('/record-attendance', async (req, res) => {
    
    // Check if the current semester data is loaded
    if (!currentSem || !currentSem.id) {
         return res.status(503).json({ message: 'System error: Current active semester is not yet loaded or set.' });
    }
    const currentSemId = currentSem.id;

    const { scholarId, timeAction } = req.body;
    
    if (!scholarId || !timeAction) {
        return res.status(400).json({ message: 'Missing scholar ID or time action.' });
    }

    const gratis_date = dayjs().tz('Asia/Manila').format('YYYY-MM-DD');
    const currentTime = dayjs().tz('Asia/Manila').format('HH:mm:ss');
    
    let connection;

    try {
        connection = await db.getConnection();
        await connection.beginTransaction();

        // 1. Fetch scholar details (including email for the new feature)
        const [scholarRows] = await connection.query(
            'SELECT sched_id, sched_id_2, sem_id, firstname, surname, email FROM Scholar WHERE id = ?',
            [scholarId]
        );
        if (scholarRows.length === 0) {
             await connection.rollback();
             return res.status(404).json({ message: 'Scholar not found.' });
        }
        const { sched_id, sched_id_2, sem_id, firstname, surname, email } = scholarRows[0];
        const scholarName = `${firstname} ${surname}`;

        // --- CRITICAL ENFORCEMENT: Check scholar's enrollment against current semester ---
        if (sem_id !== currentSemId) {
             await connection.rollback();
             return res.status(403).json({ 
                 message: `Cannot record attendance. Scholar is enrolled in a different semester (ID: ${sem_id}) than the current active one (ID: ${currentSemId}).` 
             });
        }
        // --- END CRITICAL ENFORCEMENT ---

        // Day-of-week check (moved inside to run after sem check)
        const scheduleDayMatch = checkScheduleDayMatch(sched_id, sched_id_2);
        if (!scheduleDayMatch) {
             await connection.rollback();
             return res.status(403).json({ 
                 message: `Cannot record attendance. The scholar has no schedule on ${dayjs().tz('Asia/Manila').format('dddd')}.` 
             });
        }
        
        const wholeDayIds = [13, 14, 15, 16, 17, 18];
        const isWholeDay = wholeDayIds.includes(sched_id) || wholeDayIds.includes(sched_id_2);


        const [logRows] = await connection.query(
            'SELECT * FROM GratisLogs WHERE scholar_id = ? AND gratis_date = ? AND time_out IS NULL ORDER BY id DESC LIMIT 1',
            [scholarId, gratis_date]
        );
        
        const latestLog = logRows.length > 0 ? logRows[0] : null;

        if (timeAction === 'TIME IN') {
            
            // Record TIME IN
            const { status } = determineAdjustedTimes(sched_id, sched_id_2, currentTime, null);
            
            // Note: sem_id is correctly used here from the scholarRows data.
            const insertSql = 'INSERT INTO GratisLogs (scholar_id, gratis_date, time_in, totalduty, total_time_duty, status, sem_id) VALUES (?, ?, ?, 0, 0, ?, ?)';
            await connection.query(insertSql, [scholarId, gratis_date, currentTime, status, sem_id]);
            
            await connection.commit();
            
            // *** NEW: SEND TIME IN EMAIL ***
            await sendAttendanceEmail(email, scholarName, 'Time In', currentTime, gratis_date);
            
            return res.json({ message: `Time In recorded at ${currentTime}.` });

        } else if (timeAction === 'TIME OUT') {
            if (!latestLog) {
                 await connection.rollback();
                 return res.status(400).json({ message: 'Cannot Time Out. No outstanding Time In found for today.' });
            }

            const log_id = latestLog.id;
            const timeInStr = latestLog.time_in;
            
            // 2. Determine Adjusted Times and Status
            const { status: initialStatus, adjustedTimeIn, adjustedTimeOut } = 
                determineAdjustedTimes(sched_id, sched_id_2, timeInStr, currentTime);
            
            // Total duty for THIS log entry (NOW IN MINUTES)
            const totaldutyMinutes = calculateTotalDuty(adjustedTimeIn, adjustedTimeOut, isWholeDay);
            
            let finalStatus = initialStatus === 'Late' ? 'Late' : 'Present';
            
            // 3. Update the log with time_out, totalduty (MINUTES), and status
            const updateSql = `
                 UPDATE GratisLogs 
                 SET time_out = ?, totalduty = ?, status = ? 
                 WHERE id = ?`; 
            await connection.query(updateSql, [currentTime, totaldutyMinutes, finalStatus, log_id]);

            // 4. Calculate the Total Time Duty (HOURS) for the scholar's entire semester
            const totalTimeDutyHours = await calculateTotalTimeDuty(scholarId, sem_id, connection);

            // 5. Update the total_time_duty column across ALL log entries for the scholar/semester
            await connection.query(
                `UPDATE GratisLogs SET total_time_duty = ? WHERE scholar_id = ? AND sem_id = ?`,
                [totalTimeDutyHours, scholarId, sem_id]
            );

            await connection.commit();

            // *** NEW: SEND TIME OUT EMAIL ***
            await sendAttendanceEmail(email, scholarName, 'Time Out', currentTime, gratis_date, totaldutyMinutes, totalTimeDutyHours);

            return res.json({ message: `Time Out recorded at ${currentTime}. Duty recorded: ${totaldutyMinutes} minutes. Total Semester Duty: ${totalTimeDutyHours} hours.` });

        } else {
             await connection.rollback();
             return res.status(400).json({ message: 'Invalid time action specified.' });
        }

    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Error in /record-attendance:', error);
        return res.status(500).json({ message: 'Server error during attendance logging.' });
    } finally {
        if (connection) connection.release();
    }
});

// --- NEW UTILITY FUNCTION: Send Attendance Email ---
/**
 * Sends an email confirmation to the scholar.
 * @param {string} toEmail - Scholar's email address.
 * @param {string} scholarName - Full name of the scholar.
 * @param {string} action - 'Time In' or 'Time Out'.
 * @param {string} time - The time recorded (HH:mm:ss).
 * @param {string} date - The date recorded (YYYY-MM-DD).
 * @param {number} [dutyMinutes] - Total duty minutes for Time Out.
 * @param {number} [totalSemesterHours] - Total cumulative semester hours for Time Out.
 */
async function sendAttendanceEmail(toEmail, scholarName, action, time, date, dutyMinutes = 0, totalSemesterHours = 0) {
    if (!toEmail) {
        console.error(`[EMAIL] Cannot send ${action} email. Scholar email is missing.`);
        return;
    }

    let subject = `Attendance Recorded: ${action} Successful`;
    let body = `Dear ${scholarName},\n\n`;

    if (action === 'Time In') {
        body += `Your Time In was successfully recorded.\n\n` +
                `Time: ${time} PHT\n` +
                `Date: ${dayjs(date).format('MMM D, YYYY')}\n\n` +
                `Thank you for your promptness. Please remember to Time Out when your duty is complete.\n`;
    } else { // Time Out
        const dutyHours = Math.floor(dutyMinutes / 60);
        const remainingMinutes = dutyMinutes % 60;
        
        body += `Your Time Out was successfully recorded.\n\n` +
                `Time: ${time} PHT\n` +
                `Date: ${dayjs(date).format('MMM D, YYYY')}\n\n` +
                `Duty Logged Today: ${dutyHours} hours and ${remainingMinutes} minutes\n` +
                `Cumulative Semester Duty: ${totalSemesterHours} hours (This semester)\n\n` +
                `Thank you for your service.\n`;
    }

    const mailOptions = {
        from: 'scholarshipdept.grc@gmail.com', // MUST match the configured 'user' above
        to: toEmail,
        subject: subject,
        text: body,
    };

    try {
        const info = await transporter.sendMail(mailOptions);
        console.log(`[EMAIL] ${action} confirmation sent to ${toEmail}. Response: ${info.response}`);
    } catch (error) {
        console.error(`[EMAIL ERROR] Failed to send ${action} confirmation to ${toEmail}:`, error);
    }
}
// --- NEW ROUTE: Manual Scholar Search (UPDATED WITH SEM CHECK) ---
app.post('/manual-search-scholar', async (req, res) => {
    const { surname, firstname } = req.body;
    
    if (!surname || !firstname) {
        return res.status(400).json({ message: 'Missing scholar name for search.' });
    }
    
    // Check if the current semester data is loaded
    if (!currentSem || !currentSem.id) {
         return res.status(503).json({ message: 'System error: Current active semester is not yet loaded or set.' });
    }
    const currentSemId = currentSem.id; 

    try {
        // 1. Fetch Scholar, Semester, Dept, Church, and Schedule details by Name
        const scholarSql = `
             SELECT 
                 s.id AS scholar_id, s.surname, s.firstname, s.profile, s.sched_id, s.sched_id_2, s.sem_id,
                 sem.semname, sem.datestart,
                 dept.deptname,
                 ch.chname,
                 sch1.sched AS sched1_desc,
                 sch2.sched AS sched2_desc
             FROM Scholar s
             LEFT JOIN Semester sem ON s.sem_id = sem.id
             LEFT JOIN Department dept ON s.dept_id = dept.id
             LEFT JOIN Church ch ON s.church_id = ch.id
             LEFT JOIN Schedule sch1 ON s.sched_id = sch1.id
             LEFT JOIN Schedule sch2 ON s.sched_id_2 = sch2.id
             WHERE s.surname = ? AND s.firstname = ? AND s.sem_id = ?`; // <-- CRITICAL: Enforces sem_id match

        const [rows] = await db.query(scholarSql, [surname, firstname, currentSemId]);

        if (rows.length === 0) {
            return res.status(404).json({ 
                message: 'Scholar not found, or they are not enrolled in the current active semester.',
                scheduleMatch: false 
            });
        }
        
        if (rows.length > 1) {
            // Note: This check might still be hit if two active scholars have the same name.
            return res.status(400).json({ message: 'Multiple scholars found. Please be more specific.' });
        }

        const scholar = rows[0];
        const scholar_id = scholar.scholar_id;
        const gratis_date = dayjs().tz('Asia/Manila').format('YYYY-MM-DD'); 

        // *** DAY-OF-WEEK CHECK ***
        const scheduleDayMatch = checkScheduleDayMatch(scholar.sched_id, scholar.sched_id_2);
        
        if (!scheduleDayMatch) {
            return res.status(403).json({ 
                message: `Cannot record attendance. The scholar does not have a scheduled duty on ${dayjs().tz('Asia/Manila').format('dddd')}.`,
                scheduleMatch: false 
            });
        }
        // *** END DAY CHECK ***

        // 2. Determine Schedule Type and Details
        const scheduleType = scholar.sched_id && scholar.sched_id_2 ? 'HALF DAY' : 'WHOLE DAY';
        const scheduleDetails = scholar.sched_id_2 
            ? `${scholar.sched1_desc} / ${scholar.sched2_desc}` 
            : scholar.sched1_desc || 'No Schedule Set';
        
        // 3. Fetch all schedules for comparison 
        const [scheduleRows] = await db.query('SELECT * FROM Schedule');
        const dbSchedules = scheduleRows.reduce((map, obj) => {
            map[obj.id] = obj.sched;
            return map;
        }, {});
        
        // 4. Check Schedule Match (This checks the time window)
        const scheduleMatch = checkScheduleMatch(scholar.sched_id, scholar.sched_id_2, dbSchedules);

        // 5. Determine if TIME IN or TIME OUT is needed
        const [logRows] = await db.query(
            'SELECT id, time_in, time_out FROM GratisLogs WHERE scholar_id = ? AND gratis_date = ? ORDER BY id DESC LIMIT 1',
            [scholar_id, gratis_date]
        );

        let requestAction = 'TIME IN';
        let log_id_to_update = null; 

        if (logRows.length > 0) {
            const latestLog = logRows[0];
            if (latestLog.time_in && !latestLog.time_out) {
                requestAction = 'TIME OUT';
                log_id_to_update = latestLog.id;
            }
        }
        
        // 6. Assemble the data for the client (frontend modal)
        const modalData = {
            scholar_id: scholar.scholar_id,
            log_id_to_update: log_id_to_update,
            requestAction: requestAction,
            scheduleMatch: scheduleMatch, 
            
            // Display data
            name: `${scholar.firstname} ${scholar.surname}`,
            role: 'Scholar', 
            profile: scholar.profile ? scholar.profile.toString('base64') : null,
            semname: scholar.semname,
            datestart: dayjs(scholar.datestart).format('MMM D, YYYY'),
            deptname: scholar.deptname,
            chname: scholar.chname,
            scheduleType: scheduleType,
            scheduleDetails: scheduleDetails,
        };

        return res.json({
            message: `Scholar data prepared for ${requestAction} action.`,
            data: modalData
        });

    } catch (error) {
        console.error('Error in /manual-search-scholar:', error);
        return res.status(500).json({ message: 'Server error during manual data retrieval.' });
    }
});


// --- NEW ROUTE: Fetch Attendance Records for Display (REVISED) ---
app.post('/fetch-attendance-records', async (req, res) => {
    // Removed requestType from destructuring
    const { date, searchName } = req.body;
    
    // Default to current date if none provided (shouldn't happen with JS initialization)
    const gratis_date = date || dayjs().tz('Asia/Manila').format('YYYY-MM-DD');

    let connection;
    try {
        connection = await db.getConnection();

        // Base query joins GratisLogs with Scholar and Department
        let sql = `
            SELECT 
                g.gratis_date, g.time_in, g.time_out, g.totalduty, g.status,
                s.surname, s.firstname,
                d.deptname
            FROM GratisLogs g
            JOIN Scholar s ON g.scholar_id = s.id
            LEFT JOIN Department d ON s.dept_id = d.id
            WHERE g.gratis_date = ?
        `;
        const params = [gratis_date];

        // 1. Name Search Filter
        if (searchName) {
            // This search is broad: matches name (first/surname) or full name
            const searchPattern = `%${searchName}%`;
            sql += ` AND (s.surname LIKE ? OR s.firstname LIKE ? OR CONCAT(s.firstname, ' ', s.surname) LIKE ?)`;
            params.push(searchPattern, searchPattern, searchPattern);
        }

        // REMOVED: Request Type Filter Logic

        sql += ` ORDER BY s.surname ASC, g.time_in ASC`;


        const [records] = await connection.query(sql, params);

        return res.json({
            message: 'Records fetched successfully.',
            data: records
        });

    } catch (error) {
        console.error('Error in /fetch-attendance-records:', error);
        return res.status(500).json({ message: 'Server error while querying records.' });
    } finally {
        if (connection) connection.release();
    }
});


//monitoring

// Helper: returns true if scholar is already monitored today (exists in MonitoringLogs)
async function isScholarMonitoredToday(connection, scholarId) {
    const today = dayjs().tz('Asia/Manila').format('YYYY-MM-DD');
    const [rows] = await connection.query(
        'SELECT COUNT(*) AS cnt FROM MonitoringLogs WHERE scholar_id = ? AND monitoring_date = ?',
        [scholarId, today]
    );
    return (rows[0].cnt || 0) > 0;
}

// Helper: Gets latest GratisLogs id where scholar_id = ?, gratis_date = today, time_in IS NOT NULL AND time_out IS NULL
async function getOpenGratisLogId(connection, scholarId) {
    const gratis_date = dayjs().tz('Asia/Manila').format('YYYY-MM-DD');
    const [rows] = await connection.query(
        'SELECT id FROM GratisLogs WHERE scholar_id = ? AND gratis_date = ? AND time_in IS NOT NULL AND time_out IS NULL ORDER BY id DESC LIMIT 1',
        [scholarId, gratis_date]
    );
    if (rows.length === 0) return null;
    return rows[0].id;
}

/* ---------- SCAN QR ROUTE (updated to include monitored flag & latest_gratis_id) ---------- */
app.post('/monitoring-scan-qr-code', async (req, res) => {
    if (!currentSem || !currentSem.id) {
         return res.status(503).json({ message: 'System error: Current active semester is not yet loaded or set.' });
    }
    const currentSemId = currentSem.id;

    const { qrData } = req.body;
    if (!qrData) return res.status(400).json({ message: 'No QR data received.' });

    try {
        const scholarInfo = JSON.parse(qrData);
        const scholar_id = scholarInfo.id;
        const gratis_date = dayjs().tz('Asia/Manila').format('YYYY-MM-DD');

        // 1. Fetch Scholar details enforcing sem_id match
        const sql = `
             SELECT 
                 s.id AS scholar_id, s.surname, s.firstname, s.profile, s.sched_id, s.sched_id_2, s.sem_id,
                 sem.semname, sem.datestart,
                 dept.deptname,
                 ch.chname,
                 sch1.sched AS sched1_desc,
                 sch2.sched AS sched2_desc
             FROM Scholar s
             LEFT JOIN Semester sem ON s.sem_id = sem.id
             LEFT JOIN Department dept ON s.dept_id = dept.id
             LEFT JOIN Church ch ON s.church_id = ch.id
             LEFT JOIN Schedule sch1 ON s.sched_id = sch1.id
             LEFT JOIN Schedule sch2 ON s.sched_id_2 = sch2.id
             WHERE s.id = ? AND s.sem_id = ?`;
        const [rows] = await db.query(sql, [scholar_id, currentSemId]);

        if (rows.length === 0) {
            return res.status(404).json({
                message: 'Scholar not found, or they are not enrolled in the current active semester.',
                scheduleMatch: false
            });
        }

        const scholar = rows[0];

        // Day-of-week check:
        const scheduleDayMatch = checkScheduleDayMatch(scholar.sched_id, scholar.sched_id_2);
        if (!scheduleDayMatch) {
            return res.status(403).json({
                message: `Cannot record attendance. The scholar does not have a scheduled duty on ${dayjs().tz('Asia/Manila').format('dddd')}.`,
                scheduleMatch: false
            });
        }

        // Determine schedule details (unchanged)
        const scheduleType = scholar.sched_id && scholar.sched_id_2 ? 'HALF DAY' : 'WHOLE DAY';
        const scheduleDetails = scholar.sched_id_2
            ? `${scholar.sched1_desc} / ${scholar.sched2_desc}`
            : scholar.sched1_desc || 'No Schedule Set';

        // Fetch all schedule rows for time-window check
        const [scheduleRows] = await db.query('SELECT * FROM Schedule');
        const dbSchedules = scheduleRows.reduce((map, obj) => {
            map[obj.id] = obj.sched;
            return map;
        }, {});

        const scheduleMatch = checkScheduleMatch(scholar.sched_id, scholar.sched_id_2, dbSchedules);

        // Determine if TIME IN or TIME OUT
        const [logRows] = await db.query(
            'SELECT id, time_in, time_out FROM GratisLogs WHERE scholar_id = ? AND gratis_date = ? ORDER BY id DESC LIMIT 1',
            [scholar_id, gratis_date]
        );

        let requestAction = 'TIME IN';
        let log_id_to_update = null;

        if (logRows.length > 0) {
            const latestLog = logRows[0];
            if (latestLog.time_in && !latestLog.time_out) {
                requestAction = 'TIME OUT';
                log_id_to_update = latestLog.id;
            }
        }

        // Additional: check monitoringlogs for today (monitored flag) & latest open gratis id
        let latest_gratis_id = null;
        let monitored = false;

        // Acquire connection for the helper queries (or simple db.query is fine)
        const [monitorRows] = await db.query(
            'SELECT COUNT(*) AS cnt FROM MonitoringLogs WHERE scholar_id = ? AND monitoring_date = ?',
            [scholar_id, gratis_date]
        );
        monitored = (monitorRows[0].cnt || 0) > 0;

        const [openGratisRows] = await db.query(
            'SELECT id FROM GratisLogs WHERE scholar_id = ? AND gratis_date = ? AND time_in IS NOT NULL AND time_out IS NULL ORDER BY id DESC LIMIT 1',
            [scholar_id, gratis_date]
        );
        if (openGratisRows.length > 0) latest_gratis_id = openGratisRows[0].id;

        // Assemble modal data
        const modalData = {
            scholar_id: scholar.scholar_id,
            log_id_to_update: log_id_to_update,
            requestAction: requestAction,
            scheduleMatch: scheduleMatch,

            // Display
            name: `${scholar.firstname} ${scholar.surname}`,
            role: 'Scholar',
            profile: scholar.profile ? scholar.profile.toString('base64') : null,
            semname: scholar.semname,
            datestart: dayjs(scholar.datestart).format('MMM D, YYYY'),
            deptname: scholar.deptname,
            chname: scholar.chname,
            scheduleType: scheduleType,
            scheduleDetails: scheduleDetails,

            // New fields for monitoring UI
            monitored: monitored,
            latest_gratis_id: latest_gratis_id
        };

        return res.json({
            message: `Scholar data prepared for ${requestAction} action.`,
            data: modalData
        });

    } catch (error) {
        console.error('Error in /scan-qr-code:', error);
        return res.status(500).json({ message: 'Server error during data retrieval.' });
    }
});

/* ---------- MANUAL SEARCH ROUTE (updated to include monitored flag & latest_gratis_id) ---------- */
app.post('/monitoring-manual-search-scholar', async (req, res) => {
    const { surname, firstname } = req.body;
    if (!surname || !firstname) {
        return res.status(400).json({ message: 'Missing scholar name for search.' });
    }

    if (!currentSem || !currentSem.id) {
         return res.status(503).json({ message: 'System error: Current active semester is not yet loaded or set.' });
    }
    const currentSemId = currentSem.id;

    try {
        const scholarSql = `
             SELECT 
                 s.id AS scholar_id, s.surname, s.firstname, s.profile, s.sched_id, s.sched_id_2, s.sem_id,
                 sem.semname, sem.datestart,
                 dept.deptname,
                 ch.chname,
                 sch1.sched AS sched1_desc,
                 sch2.sched AS sched2_desc
             FROM Scholar s
             LEFT JOIN Semester sem ON s.sem_id = sem.id
             LEFT JOIN Department dept ON s.dept_id = dept.id
             LEFT JOIN Church ch ON s.church_id = ch.id
             LEFT JOIN Schedule sch1 ON s.sched_id = sch1.id
             LEFT JOIN Schedule sch2 ON s.sched_id_2 = sch2.id
             WHERE s.surname = ? AND s.firstname = ? AND s.sem_id = ?`;
        const [rows] = await db.query(scholarSql, [surname, firstname, currentSemId]);

        if (rows.length === 0) {
            return res.status(404).json({
                message: 'Scholar not found, or they are not enrolled in the current active semester.',
                scheduleMatch: false
            });
        }

        if (rows.length > 1) {
            return res.status(400).json({ message: 'Multiple scholars found. Please be more specific.' });
        }

        const scholar = rows[0];
        const scholar_id = scholar.scholar_id;
        const gratis_date = dayjs().tz('Asia/Manila').format('YYYY-MM-DD');

        const scheduleDayMatch = checkScheduleDayMatch(scholar.sched_id, scholar.sched_id_2);
        if (!scheduleDayMatch) {
            return res.status(403).json({
                message: `Cannot record attendance. The scholar does not have a scheduled duty on ${dayjs().tz('Asia/Manila').format('dddd')}.`,
                scheduleMatch: false
            });
        }

        const scheduleType = scholar.sched_id && scholar.sched_id_2 ? 'HALF DAY' : 'WHOLE DAY';
        const scheduleDetails = scholar.sched_id_2
            ? `${scholar.sched1_desc} / ${scholar.sched2_desc}`
            : scholar.sched1_desc || 'No Schedule Set';

        const [scheduleRows] = await db.query('SELECT * FROM Schedule');
        const dbSchedules = scheduleRows.reduce((map, obj) => {
            map[obj.id] = obj.sched;
            return map;
        }, {});
        const scheduleMatch = checkScheduleMatch(scholar.sched_id, scholar.sched_id_2, dbSchedules);

        const [logRows] = await db.query(
            'SELECT id, time_in, time_out FROM GratisLogs WHERE scholar_id = ? AND gratis_date = ? ORDER BY id DESC LIMIT 1',
            [scholar_id, gratis_date]
        );

        let requestAction = 'TIME IN';
        let log_id_to_update = null;

        if (logRows.length > 0) {
            const latestLog = logRows[0];
            if (latestLog.time_in && !latestLog.time_out) {
                requestAction = 'TIME OUT';
                log_id_to_update = latestLog.id;
            }
        }

        // new fields
        const [monitorRows] = await db.query('SELECT COUNT(*) AS cnt FROM MonitoringLogs WHERE scholar_id = ? AND monitoring_date = ?', [scholar_id, gratis_date]);
        const monitored = (monitorRows[0].cnt || 0) > 0;
        const [openGratisRows] = await db.query('SELECT id FROM GratisLogs WHERE scholar_id = ? AND gratis_date = ? AND time_in IS NOT NULL AND time_out IS NULL ORDER BY id DESC LIMIT 1', [scholar_id, gratis_date]);
        const latest_gratis_id = openGratisRows.length > 0 ? openGratisRows[0].id : null;

        const modalData = {
            scholar_id: scholar.scholar_id,
            log_id_to_update: log_id_to_update,
            requestAction: requestAction,
            scheduleMatch: scheduleMatch,
            name: `${scholar.firstname} ${scholar.surname}`,
            role: 'Scholar',
            profile: scholar.profile ? scholar.profile.toString('base64') : null,
            semname: scholar.semname,
            datestart: dayjs(scholar.datestart).format('MMM D, YYYY'),
            deptname: scholar.deptname,
            chname: scholar.chname,
            scheduleType: scheduleType,
            scheduleDetails: scheduleDetails,
            monitored: monitored,
            latest_gratis_id: latest_gratis_id
        };

        return res.json({
            message: `Scholar data prepared for ${requestAction} action.`,
            data: modalData
        });

    } catch (error) {
        console.error('Error in /manual-search-scholar:', error);
        return res.status(500).json({ message: 'Server error during manual data retrieval.' });
    }
});

/* ---------- RECORD ATTENDANCE (MonitoringLogs Only Logic) ---------- */
app.post('/monitoring-record-attendance', async (req, res) => {
    // Check for active semester
    if (!currentSem || !currentSem.id) {
        return res.status(503).json({ message: 'System error: Current active semester is not yet loaded or set.' });
    }
    const currentSemId = currentSem.id;

    const { scholarId, violation, violation_reason, monitoring_status } = req.body;

    if (!scholarId || !monitoring_status) {
        return res.status(400).json({ message: 'Missing scholar ID or monitoring status.' });
    }
    
    // Get current date/time for logging (Manila time)
    const monitoring_date = dayjs().tz('Asia/Manila').format('YYYY-MM-DD');
    const currentTime = dayjs().tz('Asia/Manila').format('HH:mm:ss'); 

    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();

        // 1. DUPLICATE SCAN CHECK (Checking MonitoringLogs directly)
        const [existingLogRows] = await connection.query(
            'SELECT id FROM MonitoringLogs WHERE scholar_id = ? AND monitoring_date = ?',
            [scholarId, monitoring_date]
        );
        
        if (existingLogRows.length > 0) {
            await connection.rollback();
            return res.status(409).json({ message: 'ATTENDANCE ALREADY RECORDED. This scholar has already been scanned for this day.' });
        }


        // 2. Fetch scholar details and verify sem match
        const [scholarRows] = await connection.query(
            'SELECT sched_id, sched_id_2, sem_id, firstname, surname, email FROM Scholar WHERE id = ?',
            [scholarId]
        );
        if (scholarRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ message: 'Scholar not found.' });
        }
        
        const { sched_id, sched_id_2, sem_id, firstname, surname, email } = scholarRows[0];
        const scholarName = `${firstname} ${surname}`;

        // Enforce same semester
        if (sem_id !== currentSemId) {
            await connection.rollback();
            return res.status(403).json({
                message: `Cannot record attendance. Scholar is enrolled in a different semester (ID: ${sem_id}) than the current active one (ID: ${currentSemId}).`
            });
        }

        // Day-of-week check (Assuming this is still required)
        const scheduleDayMatch = checkScheduleDayMatch(sched_id, sched_id_2);
        if (!scheduleDayMatch) {
            await connection.rollback();
            return res.status(403).json({
                message: `Cannot record attendance. The scholar has no schedule on ${dayjs().tz('Asia/Manila').format('dddd')}.`
            });
        }

        // 3. Get MonitoringInfo ID (Monitor ID)
        let monitoringInfoId = null;
        if (req.session && req.session.user && req.session.user.id) {
            const [monitorInfoRows] = await connection.query(
                'SELECT id FROM MonitoringInfo WHERE user_id = ?', 
                [req.session.user.id]
            );
            if (monitorInfoRows.length > 0) {
                monitoringInfoId = monitorInfoRows[0].id;
            }
        }
        
        // 4. GET THE GRATIS LOG ID (New step)
        // **This utilizes the existing helper function you provided**
        const latest_gratis_id = await getOpenGratisLogId(connection, scholarId);

        // 5. INSERT INTO MonitoringLogs
        const newMonitoring = {
            scholar_id: scholarId,
            // **gratis_id is now retrieved from the new step**
            gratis_id: latest_gratis_id, 
            monitoring_date: monitoring_date,
            status: monitoring_status, 
            violation_reason: violation ? (violation_reason || '') : null,
            count: violation ? 1 : 0,
            sem_id: sem_id,
            assigned_monitoring: monitoringInfoId
        };

        const insertMonitoringSql = `
            INSERT INTO MonitoringLogs 
            (scholar_id, gratis_id, monitoring_date, status, violation_reason, count, sem_id, assigned_monitoring)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
        
        const [monRes] = await connection.query(insertMonitoringSql, [
            newMonitoring.scholar_id,
            newMonitoring.gratis_id,
            newMonitoring.monitoring_date,
            newMonitoring.status,
            newMonitoring.violation_reason,
            newMonitoring.count,
            newMonitoring.sem_id,
            newMonitoring.assigned_monitoring
        ]);
        
        // 6. Handle Blocking (Your logic is implemented here)
        if (newMonitoring.count > 0) {
            const [sumRows] = await connection.query('SELECT COALESCE(SUM(count),0) AS total_violations FROM MonitoringLogs WHERE scholar_id = ? AND sem_id = ?', [scholarId, sem_id]);
            const totalViolations = sumRows[0].total_violations || 0;

            const penaltyThreshold = currentSem && currentSem.penalty ? parseInt(currentSem.penalty, 10) : null;
            
            // Check if scholar is already blocked for the current semester
            const [blockedCheck] = await connection.query('SELECT id FROM BlockedAccounts WHERE scholar_id = ? AND sem_id = ?', [scholarId, sem_id]);

            // **Only block if the total violations meet the threshold AND the scholar isn't already blocked**
            if (penaltyThreshold !== null && totalViolations >= penaltyThreshold && blockedCheck.length === 0) {
                const insertBlockSql = `INSERT INTO BlockedAccounts (scholar_id, monitoring_id, date_blocked, sem_id) VALUES (?, ?, ?, ?)`;
                // monitoring_id is the ID of the new MonitoringLogs entry
                await connection.query(insertBlockSql, [
                    scholarId, 
                    monitoringInfoId, // <-- CHANGED from monRes.insertId to monitoringInfoId
                    monitoring_date, 
                    sem_id
                ]);
                // You might want to send a separate 'Blocked' email here or modify the attendance email.
            }
        }

        await connection.commit();

        await sendAttendanceMonitoringEmail(
            email, 
            scholarName, 
            monitoring_date, 
            newMonitoring.count > 0, // checks if violation count is > 0 (true/false)
            newMonitoring.violation_reason 
        );

        return res.json({ 
            message: `Attendance and monitoring successfully recorded in MonitoringLogs at ${currentTime}. Status: ${monitoring_status}.`,
            log_id: monRes.insertId
        });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error('Error in /monitoring-record-attendance (MonitoringLogs Only):', error);
        return res.status(500).json({ message: 'Server error during attendance logging.' });
    } finally {
        if (connection) connection.release();
    }
});
// NOTE: This utility assumes 'transporter' (the Nodemailer object) is still globally configured.

/**
 * Sends an email confirmation for the daily monitoring scan.
 * @param {string} toEmail - Scholar's email address.
 * @param {string} scholarName - Full name of the scholar.
 * @param {string} monitoringDate - The date the monitoring was recorded (YYYY-MM-DD).
 * @param {boolean} hasViolation - True if a violation was recorded during the scan.
 * @param {string} [violationReason] - The specific reason for the violation (optional).
 */
async function sendAttendanceMonitoringEmail(toEmail, scholarName, monitoringDate, hasViolation, violationReason = null) {
    if (!toEmail) {
        console.error(`[EMAIL] Cannot send Monitoring confirmation email. Scholar email is missing.`);
        return;
    }

    // Format the date for the email body
    const formattedDate = dayjs(monitoringDate).format('MMM D, YYYY');
    
    let subject = hasViolation 
        ? `⚠️ Violation Recorded: Monitoring Log for ${formattedDate}`
        : `Monitoring Confirmation: Successful Check on ${formattedDate}`;
        
    let body = `Dear ${scholarName},\n\n`;

    if (hasViolation) {
        body += `Your daily monitoring check on ${formattedDate} was successfully recorded, but a VIOLATION was noted during the scan.\n\n`;
        body += `Violation Reason: ${violationReason || 'Not specified'}\n\n`;
        body += `If you want to appeal this violation, you need to go to the scholarship office only within 3 day of receiving this notice.\n`;
    } else {
        body += `You have been successfully monitored for your attendance requirement on ${formattedDate}.\n\n`;
        body += `Thank you for complying with the monitoring procedures.\n`;
    }
    
    body += `\n\nRegards,\nThe Scholarship Monitoring Team`;

    const mailOptions = {
        from: 'scholarshipdept.grc@gmail.com', // MUST match the configured 'user' above
        to: toEmail,
        subject: subject,
        // Using HTML for better formatting, especially for the violation message
        html: body.replace(/\n/g, '<br>'), 
    };

    try {
        const info = await transporter.sendMail(mailOptions);
        console.log(`[EMAIL] Monitoring confirmation (Violation: ${hasViolation}) sent to ${toEmail}. Response: ${info.response}`);
    } catch (error) {
        console.error(`[EMAIL ERROR] Failed to send Monitoring confirmation to ${toEmail}:`, error);
    }
}

// Function to get the logged-in MonitoringInfo ID
// This assumes the user is logged in as role_id 5 (Monitoring)
async function getMonitoringInfoId(userId) {
    const [rows] = await db.query(
        'SELECT id FROM MonitoringInfo WHERE user_id = ?',
        [userId]
    );
    return rows.length > 0 ? rows[0].id : null;
}

// --- NEW ROUTE: Fetch Monitoring Logs for Display ---
app.post('/fetch-monitoring-logs', async (req, res) => {
    // 1. Authentication and Authorization Check
    if (!req.session.loggedIn || req.session.user.role_id !== 5) {
        return res.status(403).json({ message: 'Access denied.' });
    }

    const { date, searchName } = req.body;
    const currentSemId = currentSem ? currentSem.id : null;
    const monitoringUserId = req.session.user.id; // Users.id

    if (!currentSemId) {
        return res.status(503).json({ message: 'System error: Current active semester is not yet loaded.' });
    }

    let connection;
    try {
        connection = await db.getConnection();
        
        // Find the MonitoringInfo ID (assigned_monitoring) for the logged-in user
        const assignedMonitoringId = await getMonitoringInfoId(monitoringUserId);
        if (!assignedMonitoringId) {
            return res.status(404).json({ message: 'Logged-in monitoring personnel information not found.' });
        }

        // Default to current date if none provided (from JS initialization)
        const monitoringDate = date || dayjs().tz('Asia/Manila').format('YYYY-MM-DD');

        // Base query joins MonitoringLogs with Scholar and Department
        let sql = `
            SELECT
                ml.monitoring_date, ml.status, ml.violation_reason,
                s.surname, s.firstname,
                d.deptname
            FROM MonitoringLogs ml
            JOIN Scholar s ON ml.scholar_id = s.id
            LEFT JOIN Department d ON s.dept_id = d.id
            WHERE 
                ml.monitoring_date = ?
                AND ml.sem_id = ?
                AND ml.assigned_monitoring = ?
        `;
        const params = [monitoringDate, currentSemId, assignedMonitoringId];

        // 2. Name Search Filter
        if (searchName) {
            const searchPattern = `%${searchName}%`;
            sql += ` AND (s.surname LIKE ? OR s.firstname LIKE ? OR CONCAT(s.firstname, ' ', s.surname) LIKE ?)`;
            params.push(searchPattern, searchPattern, searchPattern);
        }

        sql += ` ORDER BY s.surname ASC`;

        const [records] = await connection.query(sql, params);

        return res.json({
            message: 'Monitoring records fetched successfully.',
            data: records
        });

    } catch (error) {
        console.error('Error in /fetch-monitoring-logs:', error);
        return res.status(500).json({ message: 'Server error while querying monitoring logs.' });
    } finally {
        if (connection) connection.release();
    }
});

//violation admin
// --- VIOLATION MANAGEMENT OTP ---
// Helper function to get the current semester ID
async function getCurrentSemesterId() {
    try {
        const [results] = await db.query('SELECT id FROM Semester ORDER BY id DESC LIMIT 1');
        if (results.length > 0) {
            return results[0].id;
        }
        return null; // No semester found
    } catch (error) {
        console.error("❌ Error fetching latest semester ID:", error);
        return null;
    }
}
// SEND OTP
app.post('/send-otp-violation', async (req, res) => {
    // 1. Check if the user is logged in and has the admin role (role_id: 1)
    if (!req.session.loggedIn || req.session.user.role_id !== 1) {
        return res.status(401).send({ message: 'Unauthorized access. Admin role required.' });
    }

    const { id } = req.session.user; // Assuming 'id' in session is the user_id from Users table

    try {
        // Fetch Admin Email (Assuming ScholarAdmin or a similar table holds admin info)
        // Since you used 'ScholarAdmin' in your sample, I'll stick with that.
        // NOTE: The ID here should be the admin's ID in the 'ScholarAdmin' table.
        // If the 'id' in req.session.user is from the 'Users' table, and 'ScholarAdmin'
        // links to 'Users', you might need a JOIN, but I'll use the simpler provided structure.
        const [results] = await db.query('SELECT email FROM ScholarAdmin WHERE id = ?', [id]);
        if (results.length === 0) {
            return res.status(404).send({ message: 'Admin not found.' });
        }

        const adminEmail = results[0].email;
        if (!adminEmail) {
            return res.status(400).send({ message: 'Admin email not set.' });
        }

        // Generate and store OTP
        const otp = Math.floor(100000 + Math.random() * 900000);
        req.session.violationOTP = otp;
        req.session.otpExpiry = Date.now() + 5 * 60 * 1000; // 5 minutes expiry

        const mailOptions = {
            from: 'grc.scholarship.dept@gmail.com',
            to: adminEmail,
            subject: 'Violation Management OTP Confirmation',
            text: `Your OTP for Violation Management is: ${otp}. This OTP is valid for 5 minutes.`
        };

        await transporter.sendMail(mailOptions);
        res.status(200).send({ message: 'OTP sent to your email.' });
    } catch (error) {
        console.error('❌ Error sending OTP email for violation management:', error);
        res.status(500).send({ message: 'Failed to send OTP. Please try again.' });
    }
});


// VERIFY OTP
app.post('/verify-otp-violation', (req, res) => {
    const { otp } = req.body;
    const sessionOTP = req.session.violationOTP;
    const otpExpiry = req.session.otpExpiry;

    if (!req.session.loggedIn || req.session.user.role_id !== 1) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    // Check expiry
    if (!sessionOTP || Date.now() > otpExpiry) {
        return res.status(400).json({ success: false, message: 'OTP is expired or not set. Please request a new one.' });
    }

    // Check OTP match
    if (otp !== String(sessionOTP)) {
        return res.status(400).json({ success: false, message: 'Invalid OTP.' });
    }

    // Success: Clear OTP and set verification flag
    delete req.session.violationOTP;
    delete req.session.otpExpiry;
    req.session.violationOtpVerified = true; // Flag for subsequent data fetching

    res.json({ success: true, message: 'OTP verified successfully. You can now access the violation log.' });
});

// --- VIOLATION DATA AND REVERT ---

// FETCH VIOLATION LOGS (Must be called after successful OTP verification)
app.get('/violation-logs', async (req, res) => {
    // Check for admin role and OTP verification flag
    if (!req.session.loggedIn || req.session.user.role_id !== 1 || !req.session.violationOtpVerified) {
        return res.status(403).json({ message: 'Unauthorized: OTP verification required.' });
    }

    
    try {
        const currentSemId = await getCurrentSemesterId();

        if (!currentSemId) {
            return res.status(404).send({ message: 'No active semester found.' });
        }

        const query = `
            SELECT
                ml.id AS log_id,
                CONCAT(s.firstname, ' ', s.surname) AS scholar_name,
                ml.scholar_id,
                ml.violation_reason,
                CONCAT(mi.firstname, ' ', mi.surname) AS assigned_validator_name,
                DATE_FORMAT(ml.monitoring_date, '%Y-%m-%d') AS monitoring_date
            FROM
                MonitoringLogs ml
            JOIN
                Scholar s ON ml.scholar_id = s.id
            JOIN
                MonitoringInfo mi ON ml.assigned_monitoring = mi.id
            WHERE
                ml.sem_id = ? 
                AND ml.status = 'With Violation'
                AND ml.monitoring_date >= DATE_SUB(CURDATE(), INTERVAL 3 DAY)
            ORDER BY
                ml.monitoring_date DESC;
        `;

        const [results] = await db.query(query, [currentSemId]);

        

        res.status(200).json(results);
    } catch (error) {
        console.error('❌ Error fetching violation logs:', error);
        res.status(500).send({ message: 'Failed to fetch violation logs.' });
    }
});


// REVERT VIOLATION (Simplified, Sequential Logic)
app.post('/revert-violation/:logId', async (req, res) => {
    // Check for admin role
    if (!req.session.loggedIn || req.session.user.role_id !== 1) {
        return res.status(403).send({ message: 'Unauthorized access.' });
    }

    // logId here is the ID from the MonitoringLogs table
    const logId = req.params.logId; 

    try {
        // --- STEP 1: Get scholar_id associated with the MonitoringLogs id ---
        // We need this ID to safely delete from BlockedAccounts.
        const [logResults] = await db.query(
            'SELECT scholar_id FROM MonitoringLogs WHERE id = ?',
            [logId]
        );

        if (logResults.length === 0) {
            return res.status(404).send({ message: 'Monitoring log not found.' });
        }

        const scholarId = logResults[0].scholar_id;

        // --- STEP 2: Update MonitoringLogs: status to 'No Violation', count to 0 ---
        const [updateLog] = await db.query(
            'UPDATE MonitoringLogs SET status = "No Violation", count = 0 WHERE id = ?',
            [logId]
        );
        
        // --- STEP 3: Conditionaly remove scholar from BlockedAccounts ---
        // CRITICAL CHANGE: Deleting based ONLY on scholar_id, 
        // as the BlockedAccounts table does not store the MonitoringLogs.id.
        const [deleteBlock] = await db.query(
            'DELETE FROM BlockedAccounts WHERE scholar_id = ?',
            [scholarId] // Deletes the block for this scholar regardless of the monitoring_id
        );

        // Success response
        res.status(200).send({
            message: `Violation for log ID ${logId} successfully reverted. Blocked account entry removed: ${deleteBlock.affectedRows > 0 ? 'Yes' : 'No'}.`
        });

    } catch (error) {
        console.error('❌ Error during violation revert process:', error);
        res.status(500).send({ message: 'Failed to revert violation. Database error occurred.' });
    }
});

//fellowship
// =================================================================
// 1. GET: Fetch all Churches for the dropdown
// =================================================================
app.get('/api/churches', async (req, res) => {
    if (!req.session.loggedIn || req.session.user.role_id !== 1) {
        return res.status(403).send({ message: 'Unauthorized access.' });
    }
    try {
        const [results] = await db.query('SELECT id, chname FROM Church');
        res.json(results);
    } catch (error) {
        console.error('❌ Error fetching churches:', error);
        res.status(500).send({ message: 'Failed to fetch church data.' });
    }
});

// =================================================================
// 2. GET: Fetch all Fellowships
// =================================================================
app.get('/api/fellowships', async (req, res) => {
    if (!req.session.loggedIn || req.session.user.role_id !== 1) {
        return res.status(403).send({ message: 'Unauthorized access.' });
    }
    try {
        const query = `
            SELECT 
                F.id, F.title, F.type_fellowship, F.fellowship, F.time_start, C.chname, F.ch_id
            FROM Fellowship F
            JOIN Church C ON F.ch_id = C.id
            ORDER BY F.fellowship DESC`;
        const [results] = await db.query(query);
        res.json(results);
    } catch (error) {
        console.error('❌ Error fetching fellowships:', error);
        res.status(500).send({ message: 'Failed to fetch fellowship data.' });
    }
});


// =================================================================
// 3. POST: Add New Fellowship (and Send Email)
// =================================================================
app.post('/api/fellowships', async (req, res) => {
    if (!req.session.loggedIn || req.session.user.role_id !== 1) {
        return res.status(403).send({ message: 'Unauthorized access.' });
    }

    if (!currentSem || !currentSem.id) { 
        return res.status(500).send({ message: 'Active semester is not defined.' });
    }
    const sem_id = currentSem.id; 

    const { title, ch_id, type_fellowship, fellowship, time_start } = req.body;

    try {
        // --- STEP 1: Insert New Fellowship ---
        const insertQuery = `
            INSERT INTO Fellowship (title, ch_id, type_fellowship, fellowship, time_start, sem_id)
            VALUES (?, ?, ?, ?, ?, ?)
        `;
        const [insertResult] = await db.query(insertQuery, 
            [title, ch_id, type_fellowship, fellowship, time_start, sem_id]
        );
        const fellowshipId = insertResult.insertId;

        // --- STEP 2 (A): Fetch the Church Name ---
        const [churchResults] = await db.query('SELECT chname FROM Church WHERE id = ?', [ch_id]);
        const churchName = churchResults.length > 0 ? churchResults[0].chname : 'Unknown Church';

        // --- STEP 2 (B): Gather Emails (Scholars & Church Personnel) ---
        const emailQuery = `
            SELECT email FROM Scholar WHERE church_id = ? AND sem_id = ?
            UNION
            SELECT email FROM ChurchPersonnel WHERE church_id = ? AND sem_id = ?
        `;
        const [emailResults] = await db.query(emailQuery, [ch_id, sem_id, ch_id, sem_id]);

        if (emailResults.length > 0) {
            const recipientEmails = emailResults.map(row => row.email).join(',');
            
            // --- STEP 3: Send Email Notification ---
            const mailOptions = {
                from: 'grc.scholarship.dept@gmail.com',
                to: recipientEmails,
                subject: `UPCOMING EVENT: New ${type_fellowship} Scheduled - ${title}`,
                text: `
                    Dear Scholars and Church Personnel,
                    
                    A new ${type_fellowship} has been scheduled!
                    
                    Title/Topic: ${title}
                    Date: ${new Date(fellowship).toLocaleDateString()}
                    Time: ${time_start}
                    Church: ${churchName} 
                    
                    Please mark your calendars!
                    
                    Thank you,
                    GRC Scholarship Department
                `
            };

            await transporter.sendMail(mailOptions);
            
            res.status(201).send({ 
                message: `Fellowship added successfully and email sent to ${emailResults.length} recipients.`,
                id: fellowshipId
            });

        } else {
             res.status(201).send({ 
                 message: 'Fellowship added successfully, but no scholars/personnel found for that church to notify.'
             });
        }

    } catch (error) {
        console.error('❌ Error adding fellowship or sending email:', error);
        res.status(500).send({ message: 'Failed to add fellowship. Database or email error occurred.' });
    }
});

// =================================================================
// 4. PUT: Update Fellowship Date/Time (and Delete ExcusedScholars)
// =================================================================
app.put('/api/fellowships/:id', async (req, res) => {
    if (!req.session.loggedIn || req.session.user.role_id !== 1) {
        return res.status(403).send({ message: 'Unauthorized access.' });
    }

    const fellowshipId = req.params.id;
    const { fellowship, time_start } = req.body;

    if (!fellowship || !time_start) {
        return res.status(400).send({ message: 'Both fellowship date and time are required for update.' });
    }

    let excusedDeleted = 0;

    try {
        // --- STEP 1: Get existing data (needed for email) ---
        const [currentFellowship] = await db.query(
            `SELECT F.title, F.type_fellowship, F.ch_id, C.chname, F.fellowship, F.time_start
             FROM Fellowship F JOIN Church C ON F.ch_id = C.id
             WHERE F.id = ?`, 
            [fellowshipId]
        );

        if (currentFellowship.length === 0) {
             return res.status(404).send({ message: 'Fellowship not found.' });
        }
        
        const oldDate = new Date(currentFellowship[0].fellowship).toLocaleDateString();
        const oldTime = currentFellowship[0].time_start.substring(0, 5);
        const { title, type_fellowship, ch_id, chname } = currentFellowship[0];

        // --- STEP 2: Update Fellowship Table ---
        const updateQuery = `
            UPDATE Fellowship 
            SET fellowship = ?, time_start = ? 
            WHERE id = ?
        `;
        const [updateResult] = await db.query(updateQuery, [fellowship, time_start, fellowshipId]);

        if (updateResult.affectedRows === 0) {
            // This case should be rare since we checked if it exists, but handles if the data is identical
            return res.status(200).send({ message: 'Fellowship found, but date/time did not change.' });
        }

        // --- STEP 3: Remove records in ExcusedScholars ---
        const deleteQuery = 'DELETE FROM ExcusedScholars WHERE fellowship_id = ?';
        const [deleteResult] = await db.query(deleteQuery, [fellowshipId]);
        
        excusedDeleted = deleteResult.affectedRows;
        
        // --- STEP 4: Gather Emails (Scholars & Church Personnel) and Send Email ---
        
        // Ensure the active semester is available
        if (!currentSem || !currentSem.id) { 
             console.warn('Cannot send notification: Active semester is not defined.');
             return res.status(200).send({
                 message: `Fellowship (ID: ${fellowshipId}) successfully updated. ${excusedDeleted} excused scholar record(s) removed. (No email sent: Missing Semester ID)`
             });
        }
        const sem_id = currentSem.id;

        const emailQuery = `
            SELECT email FROM Scholar WHERE church_id = ? AND sem_id = ?
            UNION
            SELECT email FROM ChurchPersonnel WHERE church_id = ? AND sem_id = ?
        `;
        const [emailResults] = await db.query(emailQuery, [ch_id, sem_id, ch_id, sem_id]);
        
        let emailMessage = '';
        if (emailResults.length > 0) {
            const recipientEmails = emailResults.map(row => row.email).join(',');
            const newDate = new Date(fellowship).toLocaleDateString();
            const newTime = time_start.substring(0, 5);

            const mailOptions = {
                from: 'grc.scholarship.dept@gmail.com',
                to: recipientEmails,
                subject: `RESCHEDULED: ${type_fellowship} - ${title}`,
                text: `
                    Dear Scholars and Church Personnel,
                    
                    The following ${type_fellowship} has been RESCHEDULED:
                    
                    Title/Topic: ${title}
                    Church: ${chname}
                    
                    Original Date/Time: ${oldDate} at ${oldTime}
                    
                    NEW Date/Time: ${newDate} at ${newTime}
                    
                    Please update your calendars accordingly. All previous excuses are now invalid.
                    
                    Thank you,
                    GRC Scholarship Department
                `
            };
            
            await transporter.sendMail(mailOptions);
            emailMessage = `Email sent to ${emailResults.length} recipients.`;
        } else {
             emailMessage = 'No scholars/personnel found to notify.';
        }
        
        res.status(200).send({
            message: `Fellowship (ID: ${fellowshipId}) successfully updated. ${excusedDeleted} excused scholar record(s) removed. ${emailMessage}`,
            excusedRemoved: excusedDeleted
        });

    } catch (error) {
        console.error('❌ Error updating fellowship, deleting excused scholars, or sending email:', error);
        res.status(500).send({ message: 'Failed to update fellowship. Database or email error occurred.' });
    }
});

//absent request
// =======================================
// BAD WORD FILTER
// =======================================
// A simple, basic list. You should expand this extensively.
const badWords = [
    'putangina', 'tangina', 'gago', 'bobo', 'shit', 'fuck', 'tarantado', 'pota', 'inamo', 
    'pukingina', 'tae', 'bullshit', 'motherfucker', 'asshole'
];
const badWordsRegex = new RegExp(`\\b(${badWords.join('|')})\\b`, 'gi');

function filterBadWords(text) {
    // Replace all matches with [CENSORED]
    return text.replace(badWordsRegex, '[CENSORED]');
}

// =======================================
// FETCH UPCOMING FELLOWSHIP DATES
// =======================================
app.get('/api/upcoming-fellowships', async (req, res) => {
    // Security check: ensure a scholar is logged in
    if (!req.session.loggedIn || req.session.user.role_id !== 2) {
        return res.status(403).json({ message: 'Unauthorized.' });
    }

    const today = new Date().toISOString().split('T')[0]; // Current date as YYYY-MM-DD
    const user_id = req.session.user.id; // User ID from Users table
    const currentSemId = currentSem ? currentSem.id : null;

    if (!currentSemId) {
        return res.status(503).json({ message: 'System error: Current active semester is not set.' });
    }

    try {
        // --- STEP 1: Get the Scholar's Church ID (ch_id) ---
        const [scholarRows] = await db.query(
            'SELECT church_id FROM Scholar WHERE user_id = ?', 
            [user_id]
        );

        if (scholarRows.length === 0 || !scholarRows[0].church_id) {
            return res.status(404).json({ message: 'Scholar profile or assigned church not found.' });
        }
        
        const scholar_church_id = scholarRows[0].church_id;

        // --- STEP 2: Fetch fellowships that match the church, are in the current semester, and are *after* today's date (or on today's date if you use >=) ---
        // I will use `>` to strictly exclude today, matching your example logic (Oct 18 excludes Oct 18).
        const [results] = await db.query(
            `SELECT id, DATE_FORMAT(fellowship, '%Y-%m-%d') AS fellowship, type_fellowship 
            FROM Fellowship 
            WHERE sem_id = ? 
            AND ch_id = ? 
            AND fellowship > ? 
            ORDER BY fellowship ASC`,
            [currentSemId, scholar_church_id, today]
        );
        
        // The dates returned (in the `fellowship` column) are the exact dates from the table.
        // The display formatting (e.g., converting to October 31) will be handled on the frontend (scholarDash.js) when it processes this JSON response.
        
        res.json(results);

    } catch (error) {
        console.error('❌ Error fetching upcoming fellowships:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

// =======================================
// HANDLE ABSENT REQUEST SUBMISSION (WITH 2 APPROVED EXCUSE LIMIT)
// =======================================
app.post('/api/absent-request', async (req, res) => {
    // Security check: ensure a scholar is logged in (role_id 2)
    if (!req.session.loggedIn || req.session.user.role_id !== 2) {
        return res.status(403).json({ message: 'Unauthorized. Must be logged in as a Scholar.' });
    }

    const { fellowship_id, letter: rawLetter } = req.body;
    const user_id = req.session.user.id; // User ID from Users table
    // Ensure currentSemId is properly fetched from the session or another global source
    const currentSemId = req.session.user.sem_id; 
    const maxLimit = 2; // The maximum allowed approved absent requests per scholar per semester.

    if (!fellowship_id || !rawLetter) {
        return res.status(400).json({ message: 'Missing fellowship date or reason.' });
    }

    let scholarId = null;

    try {
        // --- STEP 1: Get the Scholar ID and Email ---
        const [scholarRows] = await db.query(
            'SELECT id, email FROM Scholar WHERE user_id = ?', 
            [user_id]
        );

        if (scholarRows.length === 0) {
            return res.status(404).json({ message: 'Scholar profile not found for the logged-in user.' });
        }
        
        scholarId = scholarRows[0].id; 
        const scholarEmail = scholarRows[0].email; 

        // --------------------------------------------------------------------------------
        // --- NEW STEP 2: CHECK APPROVED EXCUSE LIMIT IN ExcusedScholars TABLE ---
        // --------------------------------------------------------------------------------
        const [excusedCountRows] = await db.query(
            `SELECT COUNT(id) as totalExcused 
             FROM ExcusedScholars 
             WHERE scholar_id = ? AND sem_id = ?`,
            [scholarId, currentSemId]
        );

        const totalExcused = excusedCountRows[0].totalExcused;

        if (totalExcused >= maxLimit) {
            return res.status(403).json({ 
                message: `Absent request limit reached. You already have ${totalExcused} approved excused absences this semester.` 
            });
        }
        
        // --- STEP 3: Filter Bad Words ---
        const filteredLetter = filterBadWords(rawLetter);
        
        // --- STEP 4: Check for Duplicates (Prevent multiple *requests* for the same fellowship) ---
        // This check is on ExcuseLetters (pending/approved requests) to prevent spamming for the same date.
        const [duplicateCheck] = await db.query(
            'SELECT id FROM ExcuseLetters WHERE scholar_id = ? AND fellowship_id = ?',
            [scholarId, fellowship_id]
        );
        
        if (duplicateCheck.length > 0) {
            return res.status(409).json({ message: 'You have already sent an absent request for this specific fellowship date.' });
        }

        // --- STEP 5: Insert Request into ExcuseLetters Table (Status: Pending) ---
        const status = 'Pending';
        const [insertResult] = await db.query(
            'INSERT INTO ExcuseLetters (scholar_id, letter, status, fellowship_id, sem_id) VALUES (?, ?, ?, ?, ?)',
            [scholarId, filteredLetter, status, fellowship_id, currentSemId]
        );

        const newRequestId = insertResult.insertId;
        const remainingRequests = maxLimit - (totalExcused + 1); // Calculate remaining limit

        // --- STEP 6: Send Confirmation Email to Scholar (Logic remains the same) ---
        if (scholarEmail) {
            const [fellowshipDetails] = await db.query(
                'SELECT fellowship, type_fellowship FROM Fellowship WHERE id = ?',
                [fellowship_id]
            );
            
            const fellowshipDate = fellowshipDetails.length > 0 
                ? new Date(fellowshipDetails[0].fellowship).toLocaleDateString()
                : 'Selected Date';
            
            const fellowshipType = fellowshipDetails.length > 0 
                ? fellowshipDetails[0].type_fellowship 
                : 'Fellowship';

            if (typeof transporter !== 'undefined') {
                const mailOptions = {
                    from: 'grc.scholarship.dept@gmail.com',
                    to: scholarEmail,
                    subject: `Absent Request Sent - ${fellowshipType}`,
                    text: `
                        Dear Scholar,
                        
                        Your Absent Request (ID: ${newRequestId}) for the ${fellowshipType} on ${fellowshipDate} has been sent successfully.
                        
                        Reason Submitted: "${rawLetter.substring(0, 100)}..."
                        Status: Pending
                        
                        Please note: You have ${Math.max(0, remainingRequests)} excused absent request(s) remaining for this semester.
                        
                        You will be notified once the request has been reviewed.
                        
                        Thank you,
                        GRC Scholarship Department
                    `
                };
                
                await transporter.sendMail(mailOptions);
                console.log(`✅ Absent request confirmation email sent to ${scholarEmail}`);
            } else {
                console.warn(`⚠️ Transporter not defined. Skipping confirmation email.`);
            }
        } else {
            console.warn(`⚠️ Cannot send confirmation email: Scholar ID ${scholarId} has no email address.`);
        }

        res.status(201).json({ 
            message: 'Absent request successfully sent. A confirmation email has been sent to you.',
            id: newRequestId
        });

    } catch (error) {
        console.error('❌ Error handling absent request submission:', error);
        res.status(500).json({ message: 'Failed to process request. Database or server error occurred.' });
    }
});

// =======================================
// HANDLE SCHOLAR EXIT REQUEST SUBMISSION
// =======================================
app.post('/api/scholar/submit-exit-request', async (req, res) => {
    // Security check: ensure a scholar is logged in (role_id 2)
    if (!req.session.loggedIn || req.session.user.role_id !== 2) {
        return res.status(403).json({ message: 'Unauthorized. Must be logged in as a Scholar.' });
    }

    const { letter: rawLetter } = req.body;
    const user_id = req.session.user.id;
    const currentSemId = req.session.user.sem_id; // Get from session on login

    if (!rawLetter) {
        return res.status(400).json({ message: 'Exit reason cannot be empty.' });
    }
    
    // Check for current semester
    if (!currentSemId) {
        return res.status(503).json({ message: 'System error: Current active semester is not set in your session.' });
    }

    let scholarId = null;

    try {
        // 1. Get the Scholar ID
        const [scholarRows] = await db.query(
            'SELECT id FROM Scholar WHERE user_id = ?',
            [user_id]
        );

        if (scholarRows.length === 0) {
            return res.status(404).json({ message: 'Scholar profile not found for the logged-in user.' });
        }
        
        scholarId = scholarRows[0].id;

        // 2. Filter Bad Words
        const filteredLetter = filterBadWords(rawLetter);

        // 3. Check for Duplicates (Pending or Approved Exit Request for this scholar/semester)
        const [duplicateCheck] = await db.query(
            "SELECT id FROM ExitLetters WHERE scholar_id = ? AND sem_id = ? AND status IN ('Pending', 'Approve')",
            [scholarId, currentSemId]
        );
        
        if (duplicateCheck.length > 0) {
            return res.status(409).json({ message: 'You already have a Pending or Approved exit request for this semester.' });
        }

        // 4. Insert Request into ExitLetters Table
        const status = 'Pending';
        await db.query(
            'INSERT INTO ExitLetters (scholar_id, letter, status, sem_id) VALUES (?, ?, ?, ?)',
            [scholarId, filteredLetter, status, currentSemId]
        );

        res.status(201).json({
            message: 'Exit request successfully sent for admin review.'
        });

    } catch (error) {
        console.error('❌ Error handling exit request submission:', error);
        res.status(500).json({ message: 'Failed to process request. Database or server error occurred.' });
    }
});

// =======================================
// FETCH ALL PENDING REQUESTS (ABSENT AND EXIT)
// =======================================
app.get('/api/admin/pending-requests', async (req, res) => {
    // Security check: ensure an admin is logged in (role_id 1)
    if (!req.session.loggedIn || req.session.user.role_id !== 1) {
        return res.status(403).json({ message: 'Unauthorized. Must be logged in as an Admin.' });
    }

    if (!currentSem || !currentSem.id) {
        return res.status(500).json({ message: 'Current semester is not defined.' });
    }

    try {
        const currentSemId = currentSem.id;
        const currentDate = new Date().toISOString().slice(0, 10); // Format YYYY-MM-DD

        // --- 1. Fetch PENDING ABSENT Requests ---
        const absentQuery = `
            SELECT
                EL.id, EL.scholar_id, EL.letter, EL.sem_id, 'ABSENT' as type,
                S.firstname, S.surname, S.email,
                F.fellowship, F.id as fellowship_id
            FROM
                ExcuseLetters EL
            JOIN
                Scholar S ON EL.scholar_id = S.id
            JOIN
                Fellowship F ON EL.fellowship_id = F.id
            WHERE
                EL.status = 'Pending'
                AND EL.sem_id = ?
                AND F.fellowship > ?
            ORDER BY
                F.fellowship ASC;
        `;
        const [absentRequests] = await db.query(absentQuery, [currentSemId, currentDate]);

        // --- 2. Fetch PENDING EXIT Requests ---
        const exitQuery = `
            SELECT
                EXL.id, EXL.scholar_id, EXL.letter, EXL.sem_id, 'EXIT' as type,
                S.firstname, S.surname, S.email,
                NULL as fellowship, NULL as fellowship_id
            FROM
                ExitLetters EXL
            JOIN
                Scholar S ON EXL.scholar_id = S.id
            WHERE
                EXL.status = 'Pending'
                AND EXL.sem_id = ?
            ORDER BY
                EXL.id ASC;
        `;
        const [exitRequests] = await db.query(exitQuery, [currentSemId]);
        
        // Combine and send both request types
        const allRequests = [...absentRequests, ...exitRequests];

        res.json({ requests: allRequests });

    } catch (error) {
        console.error('❌ Error fetching all pending requests:', error);
        res.status(500).json({ message: 'Failed to fetch requests.' });
    }
});

// =======================================
// NEW GENERIC PROCESS REQUEST (ABSENT/EXIT)
// =======================================
app.post('/api/admin/process-request', async (req, res) => {
    // Security check: ensure an admin is logged in (role_id 1)
    if (!req.session.loggedIn || req.session.user.role_id !== 1) {
        return res.status(403).json({ message: 'Unauthorized. Must be logged in as an Admin.' });
    }

    const {
        requestId,
        scholarId,
        semId,
        decision, // 'Approve' or 'Rejected'
        type, // 'ABSENT' or 'EXIT'
        scholarEmail,
        scholarName,
        reason,
        fellowshipId // Only for ABSENT requests
    } = req.body;

    if (!requestId || !scholarId || !semId || !decision || (decision !== 'Approve' && decision !== 'Rejected') || !type) {
        return res.status(400).json({ message: 'Missing required request data or invalid decision/type.' });
    }

    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();

        const formattedDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        let updateTable = type === 'ABSENT' ? 'ExcuseLetters' : 'ExitLetters';
        let successMessage = '';
        let emailContext = {};

        // 1. Update status in the correct Letters table
        await connection.query(
            `UPDATE ${updateTable} SET status = ? WHERE id = ?`,
            [decision, requestId]
        );

        // 2. Perform action based on type and decision
        if (type === 'ABSENT') {
            emailContext.title = `Absent Request on ${formattedDate}`;
            if (decision === 'Approve') {
                // Insert into ExcusedScholars table
                await connection.query(
                    'INSERT INTO ExcusedScholars (scholar_id, fellowship_id, sem_id) VALUES (?, ?, ?)',
                    [scholarId, fellowshipId, semId]
                );
                successMessage = 'Absent request approved and scholar excused.';
            } else {
                successMessage = 'Absent request rejected.';
            }
        } else if (type === 'EXIT') {
            emailContext.title = `Scholar Exit Request`;
            if (decision === 'Approve') {
                // Insert into ExitAccounts table
                await connection.query(
                    'INSERT INTO ExitAccounts (scholar_id, date_exit, sem_id) VALUES (?, NOW(), ?)',
                    [scholarId, semId]
                );
                
                // OPTIONAL: Block/Deactivate the User account for the next step.
                // await connection.query('UPDATE Users SET is_active = 0 WHERE id = (SELECT user_id FROM Scholar WHERE id = ?)', [scholarId]);

                successMessage = 'Exit request approved and scholar recorded as exited.';
            } else {
                successMessage = 'Exit request rejected.';
            }
        }

        // 3. Send email notification (reusing logic from process-absent-request)
        if (scholarEmail && typeof transporter !== 'undefined') {
            const subject = `${type} Request ${decision}d - GRC Scholarship`;
            const actionText = decision === 'Approve' ? 'has been **APPROVED**' : 'has been **REJECTED**';
            const adviceText = decision === 'Approve' ? (type === 'EXIT' ? 'Your account will now be processed for exit.' : 'You are now officially excused for this fellowship.') : 'Please contact the Admin if you have any questions.';

            const mailOptions = {
                from: 'grc.scholarship.dept@gmail.com',
                to: scholarEmail,
                subject: subject,
                html: `
                    <p>Dear ${scholarName},</p>
                    <p>This is an update regarding your ${type} Request.</p>
                    <p style="padding: 10px; background-color: ${decision === 'Approve' ? '#d4edda' : '#f8d7da'}; color: ${decision === 'Approve' ? '#155724' : '#721c24'}; border: 1px solid ${decision === 'Approve' ? '#c3e6cb' : '#f5c6cb'}; border-radius: 5px;">
                        Your request ${actionText}.
                    </p>
                    <p><strong>Reason Submitted:</strong> ${reason}</p>
                    <p>${adviceText}</p>
                    <p>Thank you,</p>
                    <p>GRC Scholarship Department</p>
                `
            };

            await transporter.sendMail(mailOptions);
            console.log(`✅ ${type} request ${decision} email sent to ${scholarEmail}`);
        } else {
            console.warn(`⚠️ Cannot send ${decision} email: Scholar email missing or transporter undefined.`);
        }

        await connection.commit();
        res.json({ message: successMessage });

    } catch (error) {
        if (connection) {
            await connection.rollback();
        }
        console.error(`❌ Error processing ${type} request (${decision}):`, error);
        res.status(500).json({ message: 'Failed to process request. Database or server error occurred.' });
    } finally {
        if (connection) {
            connection.release();
        }
    }
});

// =====================================================================
// === GLOBAL VARIABLES & INITIALIZATION ===
// =====================================================================


let chp_id = null; // Church Personnel's Church ID
let currentDate = null; // Current Date (YYYY-MM-DD)
let typeFellowship = null; // 'fellowship' or 'Grand Fellowship'
let fellowshipId = null; // ID from Fellowship Table


// --- Utility function to get today's date in YYYY-MM-DD format (PHT/PST) ---
function getFormattedDate(date = new Date()) {
    // Force to Philippine Standard Time (PHT is UTC+8)
    const options = {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        timeZone: 'Asia/Manila' 
    };
    
    // Get the date string in PHT, e.g., "10/19/2025"
    const dateParts = new Intl.DateTimeFormat('en-US', options).formatToParts(date);
    
    const year = dateParts.find(p => p.type === 'year').value;
    const month = dateParts.find(p => p.type === 'month').value;
    const day = dateParts.find(p => p.type === 'day').value;
    
    return `${year}-${month}-${day}`;
}
// --- NEW HELPER: Format Date Object to Readable String ---
function toDisplayDate(dateObj) {
    if (!dateObj || !(dateObj instanceof Date)) return 'N/A';
    
    // Format the date object into a readable string like "Sept 25, 2025"
    return dateObj.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}
// --- Initialize Global Variables (Run this ONLY ONCE after ChurchPersonnel logs in) ---
async function initializeGlobalVariables(churchPersonnelId) {
    let connection;
    try {
        currentDate = getFormattedDate(); // Use PHT date

        // 1. Fetch latest semester
        const [semResults] = await db.query('SELECT * FROM Semester ORDER BY id DESC LIMIT 1');
        if (semResults.length > 0) {
            currentSem = semResults[0];
            console.log(`🎓 Active Semester Loaded: ${currentSem.semname} (ID: ${currentSem.id})`);
        } else {
            console.warn("⚠️ No semesters found in the database.");
            return;
        }

        // 2. Fetch Church Personnel's Church ID
        const [chpResults] = await db.query(
            'SELECT church_id FROM ChurchPersonnel WHERE id = ?', 
            [churchPersonnelId] 
        );
        if (chpResults.length > 0) {
            chp_id = chpResults[0].church_id;
            console.log(`👤 Church Personnel Church ID: ${chp_id}`);
        } else {
            console.warn("⚠️ Could not find Church ID for Church Personnel.");
            return;
        }

        // 3. Find today's specific fellowship event
        const fellowshipQuery = `
            SELECT id, type_fellowship
            FROM Fellowship
            WHERE DATE(fellowship) = ? AND sem_id = ? AND ch_id = ?
        `;
        const [fellowshipResults] = await db.query(fellowshipQuery, [currentDate, currentSem.id, chp_id]);

        if (fellowshipResults.length === 1) {
            fellowshipId = fellowshipResults[0].id;
            typeFellowship = fellowshipResults[0].type_fellowship;
            console.log(`🔔 Current Fellowship Event Found: ${typeFellowship} (ID: ${fellowshipId})`);
        } else {
            fellowshipId = null;
            typeFellowship = null;
            console.log("⚠️ No unique Fellowship event found for today. Attendance system disabled.");
        }

    } catch (error) {
        console.error("❌ Error initializing global variables:", error);
    }
}

async function fetchScheduleDetails(connection, schedId) {
    if (!schedId) return null;
    try {
        const [scheduleRows] = await connection.query('SELECT sched FROM Schedule WHERE id = ?', [schedId]);
        return scheduleRows.length > 0 ? scheduleRows[0].sched : 'Schedule Not Found';
    } catch (error) {
        console.error("Error fetching schedule detail:", error);
        return 'Schedule Error';
    }
}
// =====================================================================
// === /fellowship-scan-qr-code ROUTE (UPDATED) ===
// =====================================================================

app.post('/fellowship-scan-qr-code', async (req, res) => {
    if (!req.session.loggedIn || req.session.user.role_id !== 3) {
        return res.status(403).json({ message: 'Unauthorized. Must be logged in as Church Personnel (Role 3).' });
    }

    const { qrData } = req.body;
    let scholar_id; 

    if (!fellowshipId || !currentSem || !chp_id) {
        return res.status(400).json({ message: "System is not initialized. No active Fellowship event found for your church today." });
    }

    // --- Extract Scholar ID from QR Data (UNCHANGED) ---
    try {
        const scholarInfo = JSON.parse(qrData);
        scholar_id = scholarInfo.id; 
        if (!scholar_id) throw new Error('QR code missing scholar ID.');
    } catch (parseError) {
        const potentialId = parseInt(qrData); 
        if (isNaN(potentialId)) {
            return res.status(400).json({ 
                message: "Invalid QR code format. Expected a JSON object with 'id' or a numeric Scholar ID." 
            });
        }
        scholar_id = potentialId;
    }
    // ------------------------------------
    
    // 🚨 FIX: Initialize variables that might be referenced in the outer scope or in the catch block
    let connection = null;
    let alreadyScanned = false; 
    let churchMatch = false;
    let scheduleDisplay = 'N/A';
    let scheduleType = 'N/A';
    // -----------------------------------------------------------------------------------------

    try {
        connection = await db.getConnection();

        // 1. Get Scholar Info (Querying by S.id)
        const [scholarResults] = await connection.query(
            `SELECT
                S.id AS scholar_id, S.surname, S.firstname, S.email, S.profile, S.sched_id, S.sched_id_2, S.church_id,
                T.semname, T.datestart,
                D.deptname,
                C.chname
               FROM Scholar S
               JOIN Semester T ON S.sem_id = T.id
               LEFT JOIN Department D ON S.dept_id = D.id
               LEFT JOIN Church C ON S.church_id = C.id
               WHERE S.id = ? AND S.sem_id = ?`,
            [scholar_id, currentSem.id]
        );

        if (scholarResults.length === 0) {
            return res.status(404).json({ message: "Scholar not found or not enrolled in current active semester." });
        }

        const scholar = scholarResults[0];

        // 2. Check for Previous Scan/Attendance
        const [presentLog] = await connection.query(
            `SELECT * FROM FellowshipLogs 
             WHERE scholar_id = ? AND attendance = ? AND sem_id = ? AND status = 'Present'`,
            [scholar.scholar_id, currentDate, currentSem.id]
        );
        // This is where it's assigned, but it was already declared at the top of the try block
        alreadyScanned = presentLog.length > 0; 
        
        // 3. Determine Church Conditional Background
        churchMatch = scholar.church_id === chp_id;

        // --- 4. SCHEDULE NAME IMPLEMENTATION ---
        const sched1Desc = await fetchScheduleDetails(connection, scholar.sched_id);
        const sched2Desc = scholar.sched_id_2 ? await fetchScheduleDetails(connection, scholar.sched_id_2) : null;
        
        scheduleDisplay = sched1Desc || 'No Schedule Set';
        if (sched2Desc && sched2Desc !== 'Schedule Not Found' && sched2Desc !== 'Schedule Error') {
            scheduleDisplay = `${sched1Desc} / ${sched2Desc}`;
        }
        
        // 5. Determine Schedule Type (logic for Half Day/Whole Day remains for internal use)
        const s1 = scholar.sched_id;
        const s2 = scholar.sched_id_2;
        if ((s1 >= 13 && s1 <= 18) || (s2 >= 13 && s2 <= 18)) {
            scheduleType = 'Whole Day';
        } else if ((s1 >= 1 && s1 <= 12) || (s2 >= 1 && s2 <= 12)) {
            scheduleType = 'Half Day';
        }

        // 6. Determine Type of Fellowship Options (UNCHANGED)
        const typeOptions = [];
        if (typeFellowship === 'fellowship') {
            typeOptions.push('Fellowship');
        } else if (typeFellowship === 'Grand Fellowship') {
            typeOptions.push('Grand Fellowship');
        }
        
        const [sServiceCheck] = await connection.query(
            `SELECT total_sService FROM FellowshipLogs 
             WHERE scholar_id = ? AND sem_id = ? 
             ORDER BY id DESC LIMIT 1`,
            [scholar.scholar_id, currentSem.id]
        );

        if (sServiceCheck.length > 0 && sServiceCheck[0].total_sService > 0) {
            typeOptions.push('Sunday Service');
        }

        // 7. CRITICAL FIX: Format the datestart date object 
        const displayDateStart = toDisplayDate(currentSem.datestart);

        // Prepare data for the modal
        const scholarData = {
            scholar_id: scholar.scholar_id,
            profile: scholar.profile ? scholar.profile.toString('base64') : null,
            name: `${scholar.surname} ${scholar.firstname}`,
            semesterName: `${currentSem.semname} (${displayDateStart})`, 
            requestStatus: alreadyScanned ? 'Already Scanned' : 'Not Scanned',
            schedule: scheduleDisplay, 
            scheduleType: scheduleType,
            department: scholar.deptname,
            churchName: scholar.chname,
            churchBgColor: churchMatch ? 'green' : 'red',
            typeOptions: typeOptions,
            global: {
                currentSemId: currentSem.id,
                currentDate: currentDate,
                fellowshipId: fellowshipId,
                scholarEmail: scholar.email,
                scholarFullName: `${scholar.firstname} ${scholar.surname}`
            }
        };

        res.json({ message: "Scholar data retrieved successfully.", data: scholarData });

    } catch (error) {
        console.error("❌ Error processing QR scan:", error);
        res.status(500).json({ message: "An error occurred on the server while fetching scholar data." });
    } finally {
        if (connection) connection.release();
    }
});

// =====================================================================
// === /fellowship-record-attendance (UNCHANGED) ===
// =====================================================================

app.post('/fellowship-record-attendance', async (req, res) => {
    if (!req.session.loggedIn || req.session.user.role_id !== 3) {
        return res.status(403).json({ message: 'Unauthorized. Must be logged in as Church Personnel.' });
    }
    
    const { 
        scholar_id, typeOfAttendance, currentDate, currentSemId, scholarEmail, scholarFullName
    } = req.body;

    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();

        // 1. Check for duplicate 'Present' log
        const [logCheck] = await connection.query(
            `SELECT * FROM FellowshipLogs WHERE scholar_id = ? AND attendance = ? AND sem_id = ? AND status = 'Present'`,
            [scholar_id, currentDate, currentSemId]
        );
        if (logCheck.length > 0) {
            await connection.rollback();
            return res.status(409).json({ message: `Attendance for ${scholarFullName} already recorded as Present today.` });
        }

        let total_fellowship_inc = typeOfAttendance === 'Fellowship' ? 1 : 0;
        let total_grand_inc = typeOfAttendance === 'Grand Fellowship' ? 1 : 0;

        // 2. Get existing log counts to ensure correct cumulative totals
        const [prevLogs] = await connection.query(
            `SELECT total_fellowship, total_grand, absent, total_sService 
             FROM FellowshipLogs 
             WHERE scholar_id = ? AND sem_id = ? 
             ORDER BY id DESC LIMIT 1`,
            [scholar_id, currentSemId]
        );
        const prev = prevLogs[0] || { total_fellowship: 0, total_grand: 0, absent: 0, total_sService: 0 };

        // 3. Insert new 'Present' attendance log
        const insertQuery = `
            INSERT INTO FellowshipLogs 
            (scholar_id, attendance, status, typeofattendance, total_fellowship, total_grand, absent, total_sService, sem_id) 
            VALUES (?, ?, 'Present', ?, ?, ?, ?, ?, ?)
        `;
        await connection.query(insertQuery, [
            scholar_id, 
            currentDate, 
            typeOfAttendance, 
            prev.total_fellowship + total_fellowship_inc, 
            prev.total_grand + total_grand_inc, 
            prev.absent, // Remain 0 if status is Present (Absents are handled by cron)
            prev.total_sService, // Remain 0 if status is Present (SServ is handled by cron/penalties)
            currentSemId
        ]);

        // 4. Send Email Notification
        if (scholarEmail && typeof transporter !== 'undefined') {
            const subject = `Attendance Recorded: ${typeOfAttendance}`;
            const mailOptions = {
                from: 'grc.scholarship.dept@gmail.com',
                to: scholarEmail,
                subject: subject,
                html: `<p>Dear ${scholarFullName},</p><p>Your attendance for today's **${typeOfAttendance}** on <strong>${currentDate}</strong> has been successfully recorded as **Present**.</p><p>GRC Scholarship Department</p>`
            };
            await transporter.sendMail(mailOptions);
        }

        await connection.commit();
        res.json({ message: `Attendance for ${scholarFullName} recorded successfully as Present.` });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error("❌ Error recording attendance:", error);
        res.status(500).json({ message: 'Failed to record attendance. Database or server error occurred.' });
    } finally {
        if (connection) connection.release();
    }
});

// =====================================================================
// === Cron Job for Nightly Attendance Processing (UNCHANGED) ===
// =====================================================================

cron.schedule('30 23 * * *', async () => {
    console.log('--- 🌙 Running nightly Absent/Excuse process... ---');

    // Process YESTERDAY's date
    const dateToProcess = getFormattedDate(new Date(Date.now() - 24 * 60 * 60 * 1000)); 
    let connection;

    try {
        connection = await db.getConnection();
        
        // 1. Get current semester details
        const [semResults] = await connection.query('SELECT * FROM Semester ORDER BY id DESC LIMIT 1');
        if (semResults.length === 0) {
            console.warn("⚠️ No semesters found to process attendance.");
            return;
        }
        const currentSem = semResults[0];
        const currentSemId = currentSem.id;
        const sServicePenalty = currentSem.sService; // Value to increment total_sService by

        // 2. Identify all Fellowships that occurred yesterday (for all churches)
        const [yesterdayFellowships] = await connection.query(
            `SELECT id, ch_id, type_fellowship FROM Fellowship WHERE DATE(fellowship) = ? AND sem_id = ?`,
            [dateToProcess, currentSemId]
        );
        
        if (yesterdayFellowships.length === 0) {
            console.log(`✅ No fellowship events found for ${dateToProcess}. Exiting cron job.`);
            return;
        }

        for (const fellowship of yesterdayFellowships) {
            const fellowshipId = fellowship.id;
            const churchId = fellowship.ch_id;
            const typeOfAttendance = fellowship.type_fellowship; // 'Fellowship' or 'Grand Fellowship'

            console.log(`\nProcessing Attendance for Fellowship ID ${fellowshipId} (Church ID: ${churchId})`);

            // 3. Find all scholars assigned to this church for the current semester
            const [allScholars] = await connection.query(
                `SELECT id, email, firstname, surname FROM Scholar WHERE church_id = ? AND sem_id = ?`,
                [churchId, currentSemId]
            );

            // 4. Find scholars who WERE Present for this Fellowship on that date
            const [presentScholars] = await connection.query(
                `SELECT scholar_id FROM FellowshipLogs WHERE attendance = ? AND sem_id = ? AND status = 'Present'`,
                [dateToProcess, currentSemId]
            );
            const presentIds = new Set(presentScholars.map(s => s.scholar_id));

            // 5. Find scholars who were EXCUSED for this Fellowship
            const [excusedScholars] = await connection.query(
                `SELECT scholar_id FROM ExcusedScholars WHERE fellowship_id = ? AND sem_id = ?`,
                [fellowshipId, currentSemId]
            );
            const excusedIds = new Set(excusedScholars.map(s => s.scholar_id));

            // 6. Loop through all scholars to determine Absent/Excused status
            for (const scholar of allScholars) {
                const scholarId = scholar.id;
                const scholarEmail = scholar.email;
                const scholarFullName = `${scholar.firstname} ${scholar.surname}`;

                if (presentIds.has(scholarId)) {
                    // Attended, skip.
                    continue;
                }
                
                // --- Get previous log counts before transaction ---
                const [prevLogs] = await connection.query(
                    `SELECT total_fellowship, total_grand, absent, total_sService 
                     FROM FellowshipLogs 
                     WHERE scholar_id = ? AND sem_id = ? 
                     ORDER BY id DESC LIMIT 1`,
                    [scholarId, currentSemId]
                );
                const prev = prevLogs[0] || { total_fellowship: 0, total_grand: 0, absent: 0, total_sService: 0 };


                if (excusedIds.has(scholarId)) {
                    // --- EXCUSED Logic ---
                    
                    await connection.beginTransaction();

                    let total_fellowship_inc = typeOfAttendance === 'fellowship' ? 1 : 0;
                    let total_grand_inc = typeOfAttendance === 'Grand Fellowship' ? 1 : 0;

                    const insertExcuseQuery = `
                        INSERT INTO FellowshipLogs 
                        (scholar_id, attendance, status, typeofattendance, total_fellowship, total_grand, absent, total_sService, sem_id) 
                        VALUES (?, ?, 'Excuse', ?, ?, ?, ?, ?, ?)
                    `;
                    await connection.query(insertExcuseQuery, [
                        scholarId, 
                        dateToProcess, 
                        typeOfAttendance, 
                        prev.total_fellowship + total_fellowship_inc, 
                        prev.total_grand + total_grand_inc, 
                        prev.absent, // remain
                        prev.total_sService, // remain
                        currentSemId
                    ]);

                    // Send Email Notification
                    if (scholarEmail && typeof transporter !== 'undefined') {
                        const subject = `Attendance Status: Excused - ${typeOfAttendance}`;
                        const mailOptions = {
                            from: 'grc.scholarship.dept@gmail.com',
                            to: scholarEmail,
                            subject: subject,
                            html: `<p>Dear ${scholarFullName},</p><p>Your attendance for the **${typeOfAttendance}** on <strong>${dateToProcess}</strong> has been automatically recorded as **Excused**.</p><p>GRC Scholarship Department</p>`
                        };
                        await transporter.sendMail(mailOptions);
                    }
                    await connection.commit();

                } else {
                    // --- ABSENT Logic ---

                    await connection.beginTransaction();
                    
                    const newAbsentCount = prev.absent + 1;
                    let sServiceIncrement = 0;

                    // Apply penalty if absent count reaches 2
                    if (newAbsentCount === 2) {
                        sServiceIncrement = sServicePenalty; 
                    }

                    const insertAbsentQuery = `
                        INSERT INTO FellowshipLogs 
                        (scholar_id, attendance, status, typeofattendance, total_fellowship, total_grand, absent, total_sService, sem_id) 
                        VALUES (?, ?, 'Absent', ?, ?, ?, ?, ?, ?)
                    `;
                    await connection.query(insertAbsentQuery, [
                        scholarId, 
                        dateToProcess, 
                        typeOfAttendance, 
                        prev.total_fellowship, // remain
                        prev.total_grand, // remain
                        newAbsentCount, // increment by one
                        prev.total_sService + sServiceIncrement, // apply penalty
                        currentSemId
                    ]);

                    // Send Email Notification
                    if (scholarEmail && typeof transporter !== 'undefined') {
                        const subject = `Attendance Status: Absent - ${typeOfAttendance}`;
                        const mailOptions = {
                            from: 'grc.scholarship.dept@gmail.com',
                            to: scholarEmail,
                            subject: subject,
                            html: `
                                <p>Dear ${scholarFullName},</p>
                                <p>Your attendance for the **${typeOfAttendance}** on <strong>${dateToProcess}</strong> has been automatically recorded as **Absent**.</p>
                                ${sServiceIncrement > 0 ? `<p style="color:red; font-weight:bold;">A penalty has been applied: ${sServiceIncrement} Sunday Service penalty added.</p>` : ''}
                                <p>GRC Scholarship Department</p>
                            `
                        };
                        await transporter.sendMail(mailOptions);
                    }
                    await connection.commit();
                }
            }
        }
        console.log('--- ✅ Nightly Absent/Excuse process finished. ---');

    } catch (error) {
        if (connection) await connection.rollback(); 
        console.error("❌ Fatal error in nightly cron job:", error);
    } finally {
        if (connection) connection.release();
    }
}, {
    scheduled: true,
    timezone: "Asia/Manila" // Use your server's/target timezone
});

// NEW HELPER: Format Date Object to Readable String 
function toDisplayDate(dateObj) {
    if (!dateObj || !(dateObj instanceof Date)) return 'N/A';
    
    // Format the date object into a readable string like "Sep 25, 2025"
    return dateObj.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}
// --- /fellowship-manual-search Route ---
app.post('/fellowship-manual-search', async (req, res) => {
    if (!req.session.loggedIn || req.session.user.role_id !== 3) {
        return res.status(403).json({ message: 'Unauthorized.' });
    }

    const { surname, firstname } = req.body;
    const currentSemId = currentSem ? currentSem.id : null;
    const chp_id = req.session.user.chp_id; // The ID of the logged-in Church Personnel

    if (!currentSemId || !chp_id) {
        return res.status(400).json({ message: "System is not initialized. No active semester or church personnel ID found." });
    }
    if (!surname || !firstname) {
        return res.status(400).json({ message: "Surname and Firstname are required." });
    }

    let connection;
    try {
        connection = await db.getConnection();

        // 1. Search for Scholars matching the name in the current semester
        const [scholarResults] = await connection.query(
            `SELECT
                S.id AS scholar_id, S.surname, S.firstname, S.email, S.profile, S.sched_id, S.sched_id_2, S.church_id,
                T.semname, T.datestart,
                D.deptname,
                C.chname
             FROM Scholar S
             JOIN Semester T ON S.sem_id = T.id
             LEFT JOIN Department D ON S.dept_id = D.id
             LEFT JOIN Church C ON S.church_id = C.id
             WHERE S.sem_id = ? AND S.surname LIKE ? AND S.firstname LIKE ?`,
            [currentSemId, `%${surname}%`, `%${firstname}%`]
        );

        if (scholarResults.length === 0) {
            return res.status(404).json({ message: "Scholar not found or not enrolled in current active semester." });
        }
        
        const scholarDataArray = [];
        // Assuming getFormattedDate() is defined elsewhere in server.js
        const currentDate = getFormattedDate(); 

        for (const scholar of scholarResults) {
            // 2. Check for Previous Scan/Attendance for TODAY
            const [presentLog] = await connection.query(
                `SELECT * FROM FellowshipLogs 
                 WHERE scholar_id = ? AND attendance = ? AND sem_id = ? AND status = 'Present'`,
                [scholar.scholar_id, currentDate, currentSemId]
            );
            const alreadyScanned = presentLog.length > 0;
            
            // 3. Determine Church Conditional Background
            const churchMatch = scholar.church_id === chp_id;

            // 4. Schedule Name Implementation 
            // Assuming fetchScheduleDetails(connection, id) is defined elsewhere in server.js
            const sched1Desc = await fetchScheduleDetails(connection, scholar.sched_id);
            const sched2Desc = scholar.sched_id_2 ? await fetchScheduleDetails(connection, scholar.sched_id_2) : null;
            
            let scheduleDisplay = sched1Desc || 'No Schedule Set';
            if (sched2Desc && sched2Desc !== 'Schedule Not Found' && sched2Desc !== 'Schedule Error') {
                scheduleDisplay = `${sched1Desc} / ${sched2Desc}`;
            }

            // 5. Determine Schedule Type
            let scheduleType = 'N/A';
            const s1 = scholar.sched_id;
            const s2 = scholar.sched_id_2;
            if ((s1 >= 13 && s1 <= 18) || (s2 >= 13 && s2 <= 18)) {
                scheduleType = 'Whole Day';
            } else if ((s1 >= 1 && s1 <= 12) || (s2 >= 1 && s2 <= 12)) {
                scheduleType = 'Half Day';
            }
            
            // 6. Determine Type of Fellowship Options (FIXED SCOPE: using 'typeFellowship' directly)
            const typeOptions = [];
            
            // Use 'typeFellowship' and 'fellowshipId' from the module/global scope
            if (typeFellowship === 'fellowship') { 
                typeOptions.push('Fellowship');
            } else if (typeFellowship === 'Grand Fellowship') {
                typeOptions.push('Grand Fellowship');
            }
            
            const [sServiceCheck] = await connection.query(
                `SELECT total_sService FROM FellowshipLogs 
                 WHERE scholar_id = ? AND sem_id = ? 
                 ORDER BY id DESC LIMIT 1`,
                [scholar.scholar_id, currentSemId]
            );

            if (sServiceCheck.length > 0 && sServiceCheck[0].total_sService > 0) {
                typeOptions.push('Sunday Service');
            }

            // Assuming toDisplayDate(dateObj) is defined elsewhere in server.js
            const displayDateStart = toDisplayDate(scholar.datestart);

            scholarDataArray.push({
                scholar_id: scholar.scholar_id,
                profile: scholar.profile ? scholar.profile.toString('base64') : null,
                name: `${scholar.surname} ${scholar.firstname}`,
                semesterName: `${scholar.semname} (${displayDateStart})`,
                requestStatus: alreadyScanned ? 'Already Scanned' : 'Not Scanned',
                schedule: scheduleDisplay, 
                scheduleType: scheduleType,
                department: scholar.deptname,
                churchName: scholar.chname,
                churchBgColor: churchMatch ? 'green' : 'red',
                typeOptions: typeOptions, // This array now contains the correct options
                global: {
                    currentSemId: currentSemId,
                    currentDate: currentDate,
                    fellowshipId: fellowshipId, // Correctly using the module-scoped variable
                    scholarEmail: scholar.email,
                    scholarFullName: `${scholar.firstname} ${scholar.surname}`
                }
            });
        }


        res.json({ message: "Scholar(s) found successfully.", data: scholarDataArray });

    } catch (error) {
        console.error("❌ Error processing manual search:", error);
        res.status(500).json({ message: "An error occurred on the server while searching for the scholar." });
    } finally {
        if (connection) connection.release();
    }
});
// --- /fellowship-get-records Route ---
app.post('/fellowship-get-records', async (req, res) => {
    if (!req.session.loggedIn || req.session.user.role_id !== 3) {
        return res.status(403).json({ message: 'Unauthorized.' });
    }

    const { attendanceDate, scholarName } = req.body;
    const currentSemId = currentSem ? currentSem.id : null;
    const chp_id = req.session.user.chp_id; // The ID of the logged-in Church Personnel

    if (!currentSemId || !chp_id || !attendanceDate) {
        return res.status(400).json({ message: "Missing required parameters (Semester ID, Church Personnel ID, or Date)." });
    }

    let connection;
    try {
        connection = await db.getConnection();

        // 1. Get the Church ID of the logged-in Church Personnel
        const [chpChurchRow] = await connection.query(
            'SELECT church_id FROM ChurchPersonnel WHERE id = ?',
            [chp_id]
        );

        if (chpChurchRow.length === 0) {
            return res.status(403).json({ message: "Church Personnel record not found." });
        }
        const personnelChurchId = chpChurchRow[0].church_id;

        // 2. Build the WHERE clause for filtering
        let whereClauses = [
            'L.sem_id = ?',
            'L.attendance = ?',
            'S.church_id = ?'
        ];
        let queryParams = [currentSemId, attendanceDate, personnelChurchId];
        
        let nameFilter = '';
        if (scholarName && scholarName.trim() !== '') {
            nameFilter = ` AND (S.firstname LIKE ? OR S.surname LIKE ?)`;
            // Split name into two words if possible, otherwise use the single word
            const parts = scholarName.trim().split(/\s+/).filter(p => p.length > 0);
            
            if (parts.length > 1) {
                // Search both firstname and surname with wildcards
                queryParams.push(`%${parts[0]}%`);
                queryParams.push(`%${parts[1]}%`);
            } else if (parts.length === 1) {
                // Search single word across both fields
                queryParams.push(`%${parts[0]}%`);
                queryParams.push(`%${parts[0]}%`);
            }
        }


        // 3. Execute the query
        const [recordResults] = await connection.query(
            `SELECT
                S.firstname, S.surname, 
                C.chname,
                L.status, L.typeofattendance
             FROM FellowshipLogs L
             JOIN Scholar S ON L.scholar_id = S.id
             LEFT JOIN Church C ON S.church_id = C.id
             WHERE ${whereClauses.join(' AND ')} ${nameFilter}
             ORDER BY S.surname, S.firstname`,
            queryParams
        );

        if (recordResults.length === 0) {
            return res.status(200).json({ message: "No attendance records found for your church on this date." });
        }

        const recordsData = recordResults.map(r => ({
            name: `${r.firstname} ${r.surname}`,
            churchName: r.chname,
            status: r.status,
            typeOfAttendance: r.typeofattendance
        }));

        res.json({ message: "Records retrieved successfully.", data: recordsData });

    } catch (error) {
        console.error("❌ Error fetching attendance records:", error);
        res.status(500).json({ message: "An error occurred on the server while fetching attendance records." });
    } finally {
        if (connection) connection.release();
    }
});

// Add this new endpoint to your server.js
app.get('/api/scholar/gratis-records', async (req, res) => {
    // 1. Determine the ID of the scholar currently login (currentLoginId)
    if (!req.session.loggedIn || req.session.user.role_id !== 2) {
        return res.status(401).json({ message: 'Unauthorized or not a scholar.' });
    }

    const userId = req.session.user.id;
    const currentSemId = req.session.user.sem_id;

    try {
        const [scholarData] = await db.query(`
            SELECT 
                S.id AS scholar_id,
                S.firstname,
                S.surname,
                D.deptname,
                SM.semname,
                SM.gratis AS semester_gratis_minutes, -- This is the value from the DB, assumed in minutes
                SM.id AS semester_id
            FROM Scholar S
            JOIN Department D ON S.dept_id = D.id
            JOIN Semester SM ON S.sem_id = SM.id
            WHERE S.user_id = ? AND S.sem_id = ?
        `, [userId, currentSemId]);

        if (scholarData.length === 0) {
            return res.status(404).json({ message: 'Scholar record not found for this user/semester.' });
        }
        const scholar = scholarData[0];
        const scholarId = scholar.scholar_id;

        const [gratisRecords] = await db.query(`
            SELECT 
                GL.id AS gratis_id,
                GL.gratis_date,
                GL.time_in,
                GL.time_out,
                GL.status,
                GL.totalduty,
                ML.status AS monitoring_status
            FROM GratisLogs GL
            LEFT JOIN MonitoringLogs ML ON GL.id = ML.gratis_id AND GL.sem_id = ML.sem_id
            WHERE GL.scholar_id = ? AND GL.sem_id = ?
            ORDER BY GL.gratis_date DESC
        `, [scholarId, currentSemId]);
        
        let totalDutyTime = 0; // in minutes
        let noOfDates = new Set();
        let noOfLates = 0;
        let noOfViolations = 0;

        gratisRecords.forEach(record => {
            totalDutyTime += record.totalduty || 0; 
            
            noOfDates.add(record.gratis_date.toISOString().split('T')[0]); 

            if (record.status === 'Late') {
                noOfLates++;
            }
            
            if (record.monitoring_status === 'With Violation') {
                noOfViolations++;
            }
        });
        
        // --- Format Total Time (Duty/Gratis) ---
        // totalDutyTime is in minutes. Convert to hours if >= 60.
        const totalDutyFormatted = totalDutyTime >= 60 
            ? `${(totalDutyTime / 60).toFixed(1)} hrs` 
            : `${totalDutyTime} mins`;

        // semester_gratis_minutes is from DB, assumed in minutes. Convert to hours.
        const semesterGratisFormatted = (scholar.semester_gratis_minutes / 60).toFixed(0); // Display as whole hours

        const totalTimeSummary = `${totalDutyFormatted} / ${semesterGratisFormatted} hrs`; // Display: "X hrs/mins / Y hrs"


        // ... (remaining records mapping logic, no changes needed here)
        const records = gratisRecords.map(record => {
            let formattedTotalDuty;
            if (record.totalduty === null) {
                formattedTotalDuty = 'N/A';
            } else if (record.totalduty < 60) {
                formattedTotalDuty = `${record.totalduty} mins`;
            } else {
                formattedTotalDuty = `${(record.totalduty / 60).toFixed(1)} hrs`;
            }

            const statusMonitor = record.monitoring_status ? 'Monitored' : 'Not Monitored';
            const violation = record.monitoring_status === 'With Violation' ? 'With Violation' : 'No Violation';

            return {
                department: scholar.deptname,
                date: record.gratis_date.toISOString().split('T')[0],
                time_in: record.time_in,
                time_out: record.time_out,
                status: record.status,
                totalduty: formattedTotalDuty,
                statusMonitor: statusMonitor,
                violation: violation
            };
        });

        res.json({
            summary: {
                name: `${scholar.firstname} ${scholar.surname}`,
                semName: scholar.semname,
                totalTime: totalTimeSummary, // Use the new formatted summary
                noOfDates: noOfDates.size,
                noOfLates: noOfLates,
                noOfViolations: noOfViolations
            },
            records: records
        });

    } catch (error) {
        console.error("Error fetching gratis records:", error);
        res.status(500).json({ message: 'Internal server error while fetching data.' });
    }
});

// Add this new endpoint to your server.js
app.get('/api/scholar/fellowship-records', async (req, res) => {
    if (!req.session.loggedIn || req.session.user.role_id !== 2) {
        return res.status(401).json({ message: 'Unauthorized or not a scholar.' });
    }

    const userId = req.session.user.id;
    const currentSemId = req.session.user.sem_id;

    try {
        // Step 1: Get Scholar's ID, Name, Church, and Semester Info
        const [scholarData] = await db.query(`
            SELECT 
                S.id AS scholar_id,
                S.firstname,
                S.surname,
                C.chname,
                SM.semname,
                SM.fellowship AS semester_fellowship_req
            FROM Scholar S
            JOIN Church C ON S.church_id = C.id
            JOIN Semester SM ON S.sem_id = SM.id
            WHERE S.user_id = ? AND S.sem_id = ?
        `, [userId, currentSemId]);

        if (scholarData.length === 0) {
            return res.status(404).json({ message: 'Scholar record not found for this user/semester.' });
        }
        const scholar = scholarData[0];
        const scholarId = scholar.scholar_id;

        // Step 2 & 3: Get Fellowship Logs for the scholar in the current semester
        const [fellowshipRecords] = await db.query(`
            SELECT 
                id,
                attendance,
                status,
                typeofattendance,
                total_fellowship,
                total_grand,
                total_sService,
                absent
            FROM FellowshipLogs
            WHERE scholar_id = ? AND sem_id = ?
            ORDER BY attendance DESC
        `, [scholarId, currentSemId]);

        // Step 4: Get count of excused absences
        const [excusedCountResult] = await db.query(`
            SELECT COUNT(id) AS excused_count
            FROM ExcusedScholars
            WHERE scholar_id = ? AND sem_id = ?
        `, [scholarId, currentSemId]);

        const excusedCount = excusedCountResult[0].excused_count;
        
        // --- Summary Calculations ---
        let totalFellowship = 0;
        let totalGrand = 0;
        let noOfAbsent = 0;
        let latestTotalSService = 0;
        
        if (fellowshipRecords.length > 0) {
            // Calculate sums and count
            for (const record of fellowshipRecords) {
                totalFellowship += record.total_fellowship || 0;
                totalGrand += record.total_grand || 0;
                if (record.status === 'Absent') {
                    noOfAbsent++;
                }
            }
            
            // Get the latest total_sService value (since records are ordered DESC by date)
            latestTotalSService = fellowshipRecords[0].total_sService || 0;
        }

        // total fellowship: total_fellowship + total_grand / fellowship (from Semester)
        const totalDuty = totalFellowship + totalGrand;
        const totalFellowshipSummary = `${totalDuty} / ${scholar.semester_fellowship_req}`;
        
        // no of excused left: 2 - count
        const noOfExcusedLeft = Math.max(0, 2 - excusedCount); // Ensure it doesn't go below 0

        // --- Prepare final records for front-end ---
        const records = fellowshipRecords.map(record => {
            return {
                church: scholar.chname, // Church is the same for all rows
                date: record.attendance.toISOString().split('T')[0],
                status: record.status,
                typeoffellowship: record.typeofattendance,
                no_of_sService: record.total_sService,
            };
        });

        // Final Response
        res.json({
            summary: {
                name: `${scholar.firstname} ${scholar.surname}`,
                semName: scholar.semname,
                totalFellowship: totalFellowshipSummary,
                noOfAbsent: noOfAbsent,
                noOfExcusedLeft: noOfExcusedLeft,
                noOfSService: latestTotalSService,
            },
            records: records
        });

    } catch (error) {
        console.error("Error fetching fellowship records:", error);
        res.status(500).json({ message: 'Internal server error while fetching data.' });
    }
});


//event
// Add a new function in server.js to set up default settings, run in your main setup function
async function setupMainpageSettingsTable() {
    try {
        // Create table to store mainpage link statuses
        await db.query(`
            CREATE TABLE IF NOT EXISTS MainpageSettings (
                id INT PRIMARY KEY AUTO_INCREMENT,
                setting_key VARCHAR(50) UNIQUE NOT NULL,
                setting_value ENUM('ON', 'OFF') NOT NULL
            );
        `);

        // Insert initial default values if they don't exist
        await db.query(
            `INSERT IGNORE INTO MainpageSettings (setting_key, setting_value) VALUES ('renewal_status', 'ON')`
        );
        await db.query(
            `INSERT IGNORE INTO MainpageSettings (setting_key, setting_value) VALUES ('application_status', 'ON')`
        );
        console.log('✅ MainpageSettings table checked and initialized.');
    } catch (error) {
        console.error('❌ Error setting up MainpageSettings table:', error);
    }
}
// You must call setupMainpageSettingsTable() in your server startup logic (e.g., inside an init function or after database connection).

// ==============================================
// API: MAINPAGE SETTINGS (Renewal/Application Switches)
// ==============================================
// NEW: Public endpoint for fetching current renewal and application statuses
app.get('/api/public/mainpage-status', async (req, res) => {
    // NO login check here
    try {
        const [results] = await db.query('SELECT setting_key, setting_value FROM MainpageSettings');
        const settings = results.reduce((acc, row) => {
            acc[row.setting_key] = row.setting_value;
            return acc;
        }, {});

        res.json({
            renewal_status: settings.renewal_status || 'OFF',
            application_status: settings.application_status || 'OFF'
        });
    } catch (error) {
        console.error('Error fetching public mainpage settings:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});
// GET: Fetch current renewal and application statuses
app.get('/api/admin/mainpage-settings', async (req, res) => {
    if (!req.session.loggedIn || req.session.user.role_id !== 1) {
        return res.status(403).json({ message: 'Unauthorized.' });
    }

    try {
        const [results] = await db.query('SELECT setting_key, setting_value FROM MainpageSettings');
        const settings = results.reduce((acc, row) => {
            acc[row.setting_key] = row.setting_value;
            return acc;
        }, {});

        res.json({
            renewal_status: settings.renewal_status || 'OFF',
            application_status: settings.application_status || 'OFF'
        });
    } catch (error) {
        console.error('Error fetching mainpage settings:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

// POST: Update renewal or application status
app.post('/api/admin/mainpage-settings/update', async (req, res) => {
    if (!req.session.loggedIn || req.session.user.role_id !== 1) {
        return res.status(403).json({ message: 'Unauthorized.' });
    }

    const { type, status } = req.body; 

    if (!['renewal', 'application'].includes(type) || !['ON', 'OFF'].includes(status)) {
        return res.status(400).json({ message: 'Invalid setting type or status.' });
    }
    
    const key = `${type}_status`;
    
    // ⭐ New SQL: INSERT the key/value, or UPDATE the value if the key already exists.
    const sql = `
        INSERT INTO MainpageSettings (setting_key, setting_value)
        VALUES (?, ?)
        ON DUPLICATE KEY UPDATE setting_value = ?
    `;

    try {
        // Ensure the parameters map correctly: [setting_key, setting_value (for INSERT), setting_value (for UPDATE)]
        await db.query(sql, [key, status, status]); 

        res.json({ message: `${type.charAt(0).toUpperCase() + type.slice(1)} access set to ${status}.` });
    } catch (error) {
        console.error(`Error updating ${key}:`, error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});
// ==============================================
// API: EVENT POSTING (CRUD)
// ==============================================

// POST: Create a new event
app.post('/api/admin/events/post', uploadEventImage.single('eventImage'), async (req, res) => {
    if (!req.session.loggedIn || req.session.user.role_id !== 1) {
        return res.status(403).json({ message: 'Unauthorized.' });
    }

    if (!currentSem || !currentSem.id) {
        return res.status(503).json({ message: 'System error: Current active semester is not set.' });
    }
    const semId = currentSem.id;

    if (!req.file) {
        return res.status(400).json({ message: 'Event image file is required.' });
    }

    const { eventTitle, eventDate, eventDescription, eventPrice, eventLink, eventReceiver } = req.body;
    const picEvent = req.file.buffer; // Buffer from multer.memoryStorage()

    if (!eventTitle || !eventDate || !eventDescription || !eventPrice || !eventLink || !eventReceiver) {
        return res.status(400).json({ message: 'All event fields are required.' });
    }

    const price = parseInt(eventPrice);
    const recipient = parseInt(eventReceiver);
    
    if (isNaN(price) || price < 1 || price > 8) {
        return res.status(400).json({ message: 'Event Price must be an integer between 1 and 8.' });
    }

    if (isNaN(recipient) || recipient < 1) {
        return res.status(400).json({ message: 'Event Receiver count must be a positive integer.' });
    }

    // Set initial status to 'active'
    const status = 'active';

    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();

        // 1. Insert the new event
        const [eventResult] = await connection.query(
            `INSERT INTO Events (datestart, pic_event, title_event, info_event, link_event, status, price, recipient, sem_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [eventDate, picEvent, eventTitle, eventDescription, eventLink, status, price, recipient, semId]
        );
        const newEventId = eventResult.insertId;

        // 2. Fetch all scholars in the current semester
        const [scholars] = await connection.query(
            'SELECT email, firstname, surname FROM Scholar WHERE sem_id = ? AND email IS NOT NULL',
            [semId]
        );
        
        // 3. Email all scholars (using a similar structure as the existing email logic)
        if (scholars.length > 0 && typeof transporter !== 'undefined') {
            const subject = `🎉 New Scholarship Event: ${eventTitle}`;
            
            for (const scholar of scholars) {
                const mailOptions = {
                    from: 'grc.scholarship.dept@gmail.com',
                    to: scholar.email,
                    subject: subject,
                    html: `<p>Dear ${scholar.firstname} ${scholar.surname},</p>
                           <p>We have posted a new event: <strong>${eventTitle}</strong>.</p>
                           <p>Date: ${new Date(eventDate).toDateString()}</p>
                           <p>Description: ${eventDescription}</p>
                           <p>Check the link for more details: <a href="${eventLink}">${eventLink}</a></p>
                           <p>Visit the Mainpage to see the announcement!</p>
                           <p>GRC Scholarship Department</p>`
                };
                await transporter.sendMail(mailOptions);
            }
        }
        
        await connection.commit();
        res.json({ message: `Event "${eventTitle}" posted successfully and emailed to ${scholars.length} scholars.` });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error("❌ Error posting event:", error);
        // Handle multer file upload errors more gracefully
        if (error.code === 'LIMIT_FILE_SIZE') {
             return res.status(400).json({ message: 'File size limit exceeded (max 5MB).' });
        }
        res.status(500).json({ message: 'Failed to post event. Database or server error occurred.' });
    } finally {
        if (connection) connection.release();
    }
});

// GET: Fetch all events
app.get('/api/admin/events', async (req, res) => {
    if (!req.session.loggedIn || req.session.user.role_id !== 1) {
        return res.status(403).json({ message: 'Unauthorized.' });
    }

    if (!currentSem || !currentSem.id) {
        return res.status(503).json({ message: 'System error: Current active semester is not set.' });
    }
    const semId = currentSem.id;

    try {
        // Fetch events for the current semester, sorted by date descending
        const [results] = await db.query(
            'SELECT id, datestart, title_event, link_event, recipient, price, status FROM Events WHERE sem_id = ? ORDER BY datestart DESC',
            [semId]
        );

        // Update status for past events to 'inactive' if not already
        const today = new Date().toISOString().split('T')[0];
        
        for (const event of results) {
            const eventDate = new Date(event.datestart).toISOString().split('T')[0];
            if (eventDate < today && event.status === 'active') {
                await db.query("UPDATE Events SET status = 'inactive' WHERE id = ?", [event.id]);
                event.status = 'inactive'; // Update the object for the current response too
            }
        }

        res.json(results);
    } catch (error) {
        console.error('Error fetching events:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

// DELETE: Delete an event
app.delete('/api/admin/events/:eventId', async (req, res) => {
    if (!req.session.loggedIn || req.session.user.role_id !== 1) {
        return res.status(403).json({ message: 'Unauthorized.' });
    }

    const { eventId } = req.params;

    try {
        const [result] = await db.query('DELETE FROM Events WHERE id = ?', [eventId]);
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Event not found.' });
        }
        
        res.json({ message: `Event ID ${eventId} successfully deleted.` });
    } catch (error) {
        console.error(`Error deleting event ID ${eventId}:`, error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

// ==============================================
// API: SEND PRICE (Scholar Search & Apply)
// ==============================================

// GET: Search for scholars not yet applied price for this event
app.get('/api/admin/scholar/search-for-price', async (req, res) => {
    if (!req.session.loggedIn || req.session.user.role_id !== 1) {
        return res.status(403).json({ message: 'Unauthorized.' });
    }

    if (!currentSem || !currentSem.id) {
        return res.status(503).json({ message: 'System error: Current active semester is not set.' });
    }
    const semId = currentSem.id;

    const { name, eventId } = req.query;
    if (!name || !eventId) {
        return res.status(400).json({ message: 'Missing search name or event ID.' });
    }
    
    // Split name into potential surname and firstname
    const parts = name.split(',').map(p => p.trim());
    const [searchSurname, searchFirstname] = parts.length === 2 ? parts : [name, ''];

    try {
        // 1. Find scholars whose name matches the search and are in the current semester
        // This query also excludes scholars who have already received the price for this event
        const [scholars] = await db.query(
            `SELECT 
                s.id as scholar_id, s.surname, s.firstname, s.email
             FROM Scholar s
             LEFT JOIN EventPriceRecipient epr ON s.id = epr.scholar_id AND epr.event_id = ?
             WHERE s.sem_id = ?
               AND epr.id IS NULL -- Exclude those who already received
               AND (s.surname LIKE ? OR s.firstname LIKE ?) -- Search logic
             ORDER BY s.surname, s.firstname
             LIMIT 10`, 
             [
                eventId,
                semId, 
                `%${searchSurname}%`, 
                `%${searchFirstname.length > 0 ? searchFirstname : searchSurname}%` // If only one part, search both fields
             ]
        );

        res.json(scholars);
    } catch (error) {
        console.error('Error searching scholar for price:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

// POST: Apply price (Duty Hours) to a scholar and record the transaction
app.post('/api/admin/events/apply-price', async (req, res) => {
    if (!req.session.loggedIn || req.session.user.role_id !== 1) {
        return res.status(403).json({ message: 'Unauthorized.' });
    }

    if (!currentSem || !currentSem.id) {
        return res.status(503).json({ message: 'System error: Current active semester is not set.' });
    }
    const semId = currentSem.id;

    const { scholarId, eventId, price, fullName, email } = req.body;
    
    if (!scholarId || !eventId || !price || !fullName || !email) {
        return res.status(400).json({ message: 'Missing transaction data.' });
    }

    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();

        // 1. Check if the scholar has already received the price for this event
        const [existingRecipient] = await connection.query(
            'SELECT id FROM EventPriceRecipient WHERE scholar_id = ? AND event_id = ?',
            [scholarId, eventId]
        );

        if (existingRecipient.length > 0) {
            await connection.rollback();
            return res.status(409).json({ message: 'Scholar has already received the price for this event.' });
        }

        // 2. Add 'price' to 'total_time_duty' in GratisLogs
        // We assume GratisLogs exists for every scholar in the semester, or we insert a new one if not.
        const [logUpdate] = await connection.query(
            `UPDATE GratisLogs SET total_time_duty = total_time_duty + ? 
             WHERE scholar_id = ? AND sem_id = ?`,
            [price, scholarId, semId]
        );
        
        // If no row was updated, insert a new initial log
        if (logUpdate.affectedRows === 0) {
             await connection.query(
                `INSERT INTO GratisLogs (scholar_id, gratis_date, totalduty, total_time_duty, sem_id) 
                 VALUES (?, CURDATE(), 0, ?, ?)`,
                [scholarId, price, semId]
            );
        }

        // 3. Decrement 'recipient' count in Events table
        const [eventUpdate] = await connection.query(
            'UPDATE Events SET recipient = recipient - 1 WHERE id = ? AND recipient > 0',
            [eventId]
        );

        if (eventUpdate.affectedRows === 0) {
            await connection.rollback();
            return res.status(409).json({ message: 'Failed to apply price: Event recipient limit reached or event not found.' });
        }

        // 4. Record the transaction in EventPriceRecipient table
        await connection.query(
            'INSERT INTO EventPriceRecipient (date_receive, scholar_id, event_id, sem_id) VALUES (CURDATE(), ?, ?, ?)',
            [scholarId, eventId, semId]
        );

        // 5. Email the scholar
        if (email && typeof transporter !== 'undefined') {
            const subject = `🥳 Congratulations! Duty Hours Awarded!`;
            const mailOptions = {
                from: 'grc.scholarship.dept@gmail.com',
                to: email,
                subject: subject,
                html: `<p>Dear ${fullName},</p>
                       <p>Congratulations! You have been awarded ${price} hours which has been added to your Total Time Duty in your Gratis Logs.</p>
                       <p>This is a reward for your participation in the recent event.</p>
                       <p>Thank you for your commitment!</p>
                       <p>GRC Scholarship Department</p>`
            };
            await transporter.sendMail(mailOptions);
        }

        await connection.commit();
        res.json({ message: `${price} hours successfully awarded to ${fullName}. Email notification sent.` });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error("❌ Error applying price:", error);
        res.status(500).json({ message: 'Failed to apply price. Database or server error occurred.' });
    } finally {
        if (connection) connection.release();
    }
});

// ==============================================
// API: MAINPAGE PUBLIC DATA
// ==============================================

// GET: Fetch mainpage settings and up to 3 latest events for the public site
app.get('/api/mainpage-data', async (req, res) => {
    
    if (!currentSem || !currentSem.id) {
        return res.json({
            settings: { renewal_status: 'OFF', application_status: 'OFF' },
            events: []
        });
    }
    const semId = currentSem.id;

    try {
        // 1. Fetch mainpage settings
        const [settingsResult] = await db.query('SELECT setting_key, setting_value FROM MainpageSettings');
        const settings = settingsResult.reduce((acc, row) => {
            acc[row.setting_key] = row.setting_value;
            return acc;
        }, { renewal_status: 'OFF', application_status: 'OFF' }); // Default to OFF

        // 2. Fetch latest 3 active events
        const [events] = await db.query(
            // Fetch only necessary columns for the mainpage display
            `SELECT pic_event, link_event 
             FROM Events 
             WHERE sem_id = ? AND status = 'active'
             ORDER BY datestart DESC 
             LIMIT 3`,
            [semId]
        );

        res.json({ settings, events });
    } catch (error) {
        console.error('Error fetching public mainpage data:', error);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

// ⭐ NEW: Endpoint to fetch active events for the current semester
app.get('/api/public/active-events', async (req, res) => {
    if (!currentSem || !currentSem.id) {
        // If no current semester is loaded, return an empty array
        return res.json([]);
    }

    try {
        const [events] = await db.query(
            `SELECT pic_event, link_event 
            FROM Events 
            WHERE status = 'active' AND sem_id = ?
            ORDER BY datestart DESC 
            LIMIT 3`, // Stack up to 3 events: latest upcoming, upcoming, present date
            [currentSem.id]
        );
        
        // Convert BLOB to Base64 for image display in HTML
        const formattedEvents = events.map(event => ({
            // Assuming pic_event is a Buffer/BLOB, convert it to a Base64 string
            // which can be used in an <img> tag's src as a data URL.
            pic_event: event.pic_event ? `data:image/jpeg;base64,${event.pic_event.toString('base64')}` : null,
            link_event: event.link_event
        }));~

        res.json(formattedEvents);

    } catch (error) {
        console.error("❌ Error fetching active events:", error);
        res.status(500).json({ message: 'Failed to fetch events.' });
    }
});

//upload signature
// --- POST route for Signature Upload ---
app.post('/upload-signature', uploadSignature.single('signature'), async (req, res) => {
    // 1. Admin Role Check
    if (!req.session.loggedIn || req.session.user.role_id !== 1) {
        return res.status(401).json({ success: false, message: 'Unauthorized access.' });
    }

    // 2. Data Validation
    const fullname = req.body.fullname;
    const signatureFile = req.file;

    if (!fullname || !signatureFile) {
        return res.status(400).json({ success: false, message: 'Full name and signature file are required.' });
    }

    if (!currentSem || !currentSem.id) {
        return res.status(500).json({ success: false, message: 'Active semester is not defined. Cannot save signature.' });
    }

    // Basic fullname validation (letters and spaces only)
    if (!/^[A-Za-z\s]+$/.test(fullname)) {
        return res.status(400).json({ success: false, message: 'Full name must contain only letters and spaces.' });
    }
    
    const sem_id = currentSem.id;
    const signatureBuffer = signatureFile.buffer;

    // 3. Database Insertion
    const query = 'INSERT INTO Signature (fullname, signature, sem_id) VALUES (?, ?, ?)';
    try {
        await db.query(query, [fullname, signatureBuffer, sem_id]);
        res.json({ success: true, message: 'Signature saved successfully.' });
    } catch (err) {
        console.error('Error saving signature to database:', err);
        res.status(500).json({ success: false, message: 'Database error: Failed to save signature.' });
    }
});

// --- New Endpoint for Certificate Eligibility Check (Called on scholarDash load) ---
app.get('/check-certificate-eligibility', async (req, res) => {
    // Ensure user is logged in and is a Scholar (role_id === 2)
    if (!req.session.loggedIn || req.session.user.role_id !== 2) {
        return res.status(403).json({ message: 'Unauthorized access.' });
    }

    const scholarUserId = req.session.user.id;
    const currentSemId = req.session.user.sem_id;
    let scholarLoginId = null; // Scholar.id

    try {
        // 1. Get Scholar ID and Name
        const [scholarRows] = await db.query(
            'SELECT id, firstname, surname, email FROM Scholar WHERE user_id = ? AND sem_id = ?',
            [scholarUserId, currentSemId]
        );

        if (scholarRows.length === 0) {
            console.log('Scholar not found for user_id:', scholarUserId);
            return res.json({ qualified: false, reason: 'Scholar record not found for the current semester.' });
        }
        
        const scholar = scholarRows[0];
        scholarLoginId = scholar.id;
        const scholarFullName = `${scholar.firstname} ${scholar.surname}`;
        
        // console.log for scholarLoginId
        //console.log(`✅ scholarLoginId retrieved: ${scholarLoginId} for ${scholarFullName}`);

// ----------------------------------------------------------------------
        // FIRST CONDITION: Check Gratis Logs (total_time_duty vs. gratis from Semester)
// ----------------------------------------------------------------------
        const [semRows] = await db.query(
            'SELECT gratis, fellowship FROM Semester WHERE id = ?',
            [currentSemId]
        );
        const requiredGratis = semRows[0] ? semRows[0].gratis : 0;

        // NEW QUERY 1: Get the most recent total_time_duty (from the latest log entry).
        const [latestLog] = await db.query(
            'SELECT total_time_duty FROM GratisLogs WHERE scholar_id = ? AND sem_id = ? ORDER BY id DESC LIMIT 1',
            [scholarLoginId, currentSemId]
        );
        const totalTimeDuty = latestLog[0] ? latestLog[0].total_time_duty : 0;

        // NEW QUERY 2: Get the MIN and MAX dates across ALL log entries (aggregate).
        const [dateRange] = await db.query(
            'SELECT MIN(gratis_date) AS day1, MAX(gratis_date) AS day2 FROM GratisLogs WHERE scholar_id = ? AND sem_id = ?',
            [scholarLoginId, currentSemId]
        );
        const day1Date = dateRange[0] ? dateRange[0].day1 : null;
        const day2Date = dateRange[0] ? dateRange[0].day2 : null;
        
        let metGratis = false;
        if (totalTimeDuty >= requiredGratis) {
            metGratis = true;
            //console.log(`✅ Requirement 1 met: Total duty time (${totalTimeDuty}) is >= required gratis (${requiredGratis}).`);
        } else {
            //console.log(`❌ Requirement 1 NOT met: Total duty time (${totalTimeDuty}) is < required gratis (${requiredGratis}).`);
            return res.json({ qualified: false, reason: 'Did not meet the gratis time requirement.' });
        }


// ----------------------------------------------------------------------
        // SECOND CONDITION: Check Fellowship Logs
// ----------------------------------------------------------------------
        const requiredFellowship = semRows[0] ? semRows[0].fellowship : 0;
        const [fellowshipLogs] = await db.query(
            `SELECT total_fellowship, total_grand, absent, total_sService 
             FROM FellowshipLogs 
             WHERE scholar_id = ? AND sem_id = ? 
             ORDER BY id DESC LIMIT 1`,
            [scholarLoginId, currentSemId]
        );
        
        const fLog = fellowshipLogs[0] || { total_fellowship: 0, total_grand: 0, absent: 0, total_sService: 0 };
        const totalAttendance = fLog.total_fellowship + fLog.total_grand;
        
        let metFellowship = false;
        
        if (totalAttendance >= requiredFellowship) {
            metFellowship = true;
            //console.log(`✅ Requirement 2 met: Total attendance (${totalAttendance}) >= required fellowship (${requiredFellowship}).`);
        } 
        else if (totalAttendance === (requiredFellowship - 1)) {
            metFellowship = true;
            //console.log(`✅ Requirement 2 met: Total attendance (${totalAttendance}) equals required fellowship minus 1 (Absent once).`);
        }
        else if (totalAttendance < (requiredFellowship - 1) && fLog.absent > 1 && fLog.total_sService === 0) {
            // Implemented as requested, even if the logic seems unusual (Absent > 1 AND no SService required)
            metFellowship = true;
            //console.log(`✅ Requirement 2 met (Exception Case): Total attendance (${totalAttendance}) < required fellowship minus 1, but absent > 1 AND total_sService is 0.`);
        }
        
        if (!metFellowship) {
            console.log(`❌ Requirement 2 NOT met: Total attendance (${totalAttendance}) did not meet any condition (required: ${requiredFellowship}).`);
            return res.json({ qualified: false, reason: 'Did not meet the fellowship attendance requirement.' });
        }


// ----------------------------------------------------------------------
        // THIRD CONDITION: Check BlockedAccounts and ExitAccounts
// ----------------------------------------------------------------------
        const [blocked] = await db.query(
            'SELECT id FROM BlockedAccounts WHERE scholar_id = ? AND sem_id = ?',
            [scholarLoginId, currentSemId]
        );
        
        const [exited] = await db.query(
            'SELECT id FROM ExitAccounts WHERE scholar_id = ? AND sem_id = ?',
            [scholarLoginId, currentSemId]
        );

        let isBlockedOrExited = blocked.length > 0 || exited.length > 0;
        
        if (!isBlockedOrExited) {
            //console.log('✅ Requirement 3 met: Not found in BlockedAccounts or ExitAccounts. Qualified to display modal.');
            
            // Get data for the certificate if qualified
            const [signatureData] = await db.query(
                'SELECT fullname, signature FROM Signature WHERE sem_id = ?',
                [currentSemId]
            );

            // Format dates
            const formatDate = (dateString) => {
                if (!dateString) return 'N/A';
                const options = { month: 'long', day: 'numeric', year: 'numeric' };
                return new Date(dateString).toLocaleDateString('en-US', options);
            };

            const day1 = formatDate(day1Date);
            const day2 = formatDate(day2Date);

            // Final success response with certificate data
            return res.json({ 
                qualified: true, 
                data: {
                    fullName: scholarFullName,
                    day1: day1,
                    day2: day2,
                    signature_png: signatureData[0] ? signatureData[0].signature.toString('base64') : null, // Convert Buffer to Base64
                    scholarHead_fullname: signatureData[0] ? signatureData[0].fullname : 'Scholarship Head'
                }
            });

        } else {
            console.log('❌ Requirement 3 NOT met: Account is in BlockedAccounts or ExitAccounts.');
            return res.json({ qualified: false, reason: 'Account is blocked or exited for the current semester.' });
        }

    } catch (error) {
        console.error("❌ Error during certificate eligibility check:", error);
        res.status(500).json({ qualified: false, message: 'Internal Server Error during qualification check.' });
    }
});


// --- New Endpoint for Receiving the Certificate (DB updates + Email) ---
app.post('/receive-certificate', async (req, res) => {
    if (!req.session.loggedIn || req.session.user.role_id !== 2) {
        return res.status(403).json({ message: 'Unauthorized access.' });
    }

    const scholarUserId = req.session.user.id;
    const currentSemId = req.session.user.sem_id;
    const currentDate = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    
    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();

        // 1. Get Scholar Details
        const [scholarRows] = await connection.query(
            'SELECT id, firstname, surname, email, user_id FROM Scholar WHERE user_id = ? AND sem_id = ?',
            [scholarUserId, currentSemId]
        );
        
        if (scholarRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ message: 'Scholar record not found.' });
        }
        
        const scholar = scholarRows[0];
        const scholarLoginId = scholar.id;
        const scholarFullName = `${scholar.firstname} ${scholar.surname}`;

        // 2. Check if the certificate has ALREADY been received this semester
        const [checkReceived] = await connection.query(
            'SELECT id FROM CertificateRecipient WHERE sch_id = ? AND sem_id = ?',
            [scholarLoginId, currentSemId]
        );

        if (checkReceived.length > 0) {
            await connection.rollback();
            return res.json({ message: 'Certificate already received this semester.', logged: true });
        }

        // 3. Determine 'renew' value
        let renewValue = 0;
        const lastSemId = currentSemId - 1; // currentSem-1

        if (lastSemId >= 1) { // Check if a last semester exists conceptually
            const [lastSemRecipient] = await connection.query(
                'SELECT renew FROM CertificateRecipient WHERE sch_id = ? AND sem_id = ?',
                [scholarLoginId, lastSemId]
            );

            if (lastSemRecipient.length > 0) {
                // If found, increment last semester's renew value
                renewValue = lastSemRecipient[0].renew + 1;
            } else {
                // If not found, renew is 0 for the current semester
                renewValue = 0;
            }
        }
        
        // 4. Create row in CertificateRecipient table
        const insertQuery = `
            INSERT INTO CertificateRecipient 
            (sch_id, surname, firstname, user_id, dateReceived, renew, sem_id) 
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `;
        await connection.query(insertQuery, [
            scholarLoginId, 
            scholar.surname, 
            scholar.firstname, 
            scholar.user_id, 
            currentDate, 
            renewValue, 
            currentSemId
        ]);
        
        //console.log(`✅ Created row in CertificateRecipient for ${scholarFullName} (Renew: ${renewValue}).`);

        // 5. Email the scholar
        if (scholar.email && typeof transporter !== 'undefined') {
            const subject = `🎉 Congratulations! Your Certificate of Completion is Ready!`;
            const mailOptions = {
                from: 'grc.scholarship.dept@gmail.com',
                to: scholar.email,
                subject: subject,
                html: `<p>Dear ${scholarFullName},</p>
                       <p>We are delighted to inform you that you have successfully met all the requirements for the GRC-MLALAF Scholarship program this semester and have been awarded the Certificate of Completion.</p>
                       <p>Please check your scholar dashboard to view and download your certificate.</p>
                       <p>Congratulations on your hard work and dedication!</p>
                       <p>GRC Scholarship Department</p>`
            };
            await transporter.sendMail(mailOptions);
            console.log(`✅ Certificate notification email sent to ${scholar.email}.`);
        } else {
            console.warn(`⚠️ Could not send email for certificate to ${scholar.email}. Transporter not defined or email missing.`);
        }

        await connection.commit();
        res.json({ message: 'Certificate successfully marked as received and notification sent.', logged: true });

    } catch (error) {
        if (connection) await connection.rollback();
        console.error("❌ Error in /receive-certificate endpoint:", error);
        res.status(500).json({ message: 'Failed to record certificate receipt due to a server error.' });
    } finally {
        if (connection) connection.release();
    }
});

//report

async function getSemestersForReport() {
    // Get the current sem and the 3 preceding semesters (total 4)
    const [results] = await db.query(
        'SELECT id, semname FROM Semester ORDER BY id DESC LIMIT 4'
    );
    // Reverse to have oldest on the left, current on the right
    return results.reverse();
}

// --- SLIDE 1: Total Applicant/Renewal per Semester (Stacked Bar) ---
app.get('/api/report/applicants-by-semester', async (req, res) => {
    try {
        const semesters = await getSemestersForReport();
        const reportData = [];

        for (const sem of semesters) {
            // Count distinct applicants (freshman, transferee, old student)
            const [applicantCount] = await db.query(
                'SELECT COUNT(DISTINCT id) AS count FROM ApplicantInfo WHERE sem_id = ?',
                [sem.id]
            );

            // Count distinct renewals
            const [renewalCount] = await db.query(
                'SELECT COUNT(DISTINCT id) AS count FROM RenewalInfo WHERE sem_id = ?',
                [sem.id]
            );

            reportData.push({
                semname: sem.semname,
                applicant_count: applicantCount[0].count,
                renewal_count: renewalCount[0].count,
            });
        }

        res.json(reportData);
    } catch (error) {
        console.error('Error fetching applicant report data:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch applicant report data.' });
    }
});

// --- SLIDE 2: Scholars per Schedule Day (Bar) ---
app.get('/api/report/scholars-by-schedule', async (req, res) => {
    if (!currentSem) return res.status(500).json({ success: false, message: 'Current semester not loaded.' });
    const currentSemId = currentSem.id;

    // Mapping of Schedule IDs to Days
    const dayMap = {
        'Monday': [1, 2, 13],
        'Tuesday': [3, 4, 14],
        'Wednesday': [5, 6, 15],
        'Thursday': [7, 8, 16],
        'Friday': [9, 10, 17],
        'Saturday': [11, 12, 18],
    };

    const reportData = [];

    try {
        for (const [day, ids] of Object.entries(dayMap)) {
            // Count entries in Scholar table where sched_id OR sched_id_2 is in the list of day IDs for the current semester
            // This counts an entry for EACH schedule slot a scholar occupies on that day.
            const query = `
                SELECT SUM(
                    (CASE WHEN sched_id IN (?) THEN 1 ELSE 0 END) + 
                    (CASE WHEN sched_id_2 IN (?) THEN 1 ELSE 0 END)
                ) AS count
                FROM Scholar
                WHERE sem_id = ?
            `;
            
            // NOTE: The Scholar table structure was NOT provided, so the assumption is:
            // 1. Scholar table exists
            // 2. Scholar table has sem_id, sched_id, and sched_id_2 columns.

            const [result] = await db.query(query, [ids, ids, currentSemId]);
            const count = result[0].count || 0;

            reportData.push({ day, count: parseInt(count) });
        }

        res.json(reportData);
    } catch (error) {
        console.error('Error fetching schedule report data:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch schedule report data.' });
    }
});

// --- SLIDE 3: Weekly Late Scholars (Line Graph) - FIX: ONLY_FULL_GROUP_BY ---
app.get('/api/report/weekly-late-gratis', async (req, res) => {
    try {
        // Calculate the date 6 weeks ago
        const sixWeeksAgo = new Date();
        sixWeeksAgo.setDate(sixWeeksAgo.getDate() - 42); 
        const sixWeeksAgoStr = sixWeeksAgo.toISOString().split('T')[0];

        // SQL FIX: Added WEEK(gratis_date, 1) to the GROUP BY clause.
        const query = `
            SELECT 
                YEARWEEK(gratis_date, 1) AS week_id, 
                WEEK(gratis_date, 1) AS week_number,
                COUNT(id) AS late_count
            FROM GratisLogs
            WHERE status = 'Late' AND gratis_date >= ?
            GROUP BY week_id, week_number
            ORDER BY week_id ASC
            LIMIT 6
        `;
        
        const [results] = await db.query(query, [sixWeeksAgoStr]);
        
        const reportData = results.map(r => ({
            week_id: r.week_id,
            week_number: r.week_number,
            late_count: r.late_count
        }));

        res.json(reportData);
    } catch (error) {
        console.error('Error fetching weekly late gratis report data:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch weekly late gratis report data.' });
    }
});

// --- SLIDE 4: Top 5 Scholars by Total Duty (Bar) - FIX: fullname column ---
app.get('/api/report/top-duty-scholars', async (req, res) => {
    if (!currentSem) return res.status(500).json({ success: false, message: 'Current semester not loaded.' });
    const currentSemId = currentSem.id;
    
    // FIX: Replaced s.fullname with CONCAT(s.firstname, ' ', s.surname)
    const query = `
        SELECT 
            CONCAT(s.firstname, ' ', s.surname) AS fullname, 
            SUM(gl.totalduty) AS total_duty
        FROM GratisLogs gl
        JOIN Scholar s ON gl.scholar_id = s.id
        WHERE gl.sem_id = ?
        GROUP BY s.id, fullname
        ORDER BY total_duty DESC
        LIMIT 5
    `;

    try {
        const [results] = await db.query(query, [currentSemId]);
        res.json(results);
    } catch (error) {
        console.error('Error fetching top duty scholars report data:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch top duty scholars report data.' });
    }
});





app.get('/api/report/download/department', async (req, res) => {
    if (!currentSem) {
        return res.status(500).send('Current semester not loaded.');
    }
    const currentSemId = currentSem.id;

    try {
        // 1. Fetch data from the database (using pipe separator for clean concatenation)
        const [departments] = await db.query('SELECT id, deptname FROM Department ORDER BY deptname ASC');
        let totalScholars = 0;

        // 2. Start building the HTML content
        let htmlContent = `
            <html>
            <head>
                <meta charset="UTF-8">
                <title>Scholarship Department Report</title>
                <style>
                    body { font-family: Arial, sans-serif; max-width: 800px; margin: auto; }
                    h1 { color: #2C3E50; border-bottom: 3px solid #3498DB; padding-bottom: 10px; text-align: center; }
                    h2 { color: #16A085; text-align: center; }
                    .report-section { margin-bottom: 25px; border: 1px solid #ddd; padding: 15px; border-radius: 4px; }
                    .dept-name { font-size: 1.3em; font-weight: bold; margin-bottom: 8px; color: #34495E; }
                    .count { color: #E67E22; font-weight: bold; }
                    ul { list-style-type: disc; padding-left: 20px; }
                    li { margin-bottom: 2px; }
                </style>
            </head>
            <body>
                <h1>Scholarship Department Report</h1>
                <p style="text-align: center;"><strong>Semester ID:</strong> ${currentSemId} | <strong>Date Generated:</strong> ${new Date().toLocaleDateString()}</p>
                <hr style="border: none; border-top: 1px solid #BDC3C7;">
        `;
        
        for (const dept of departments) {
            const query = `
                SELECT 
                    COUNT(s.id) AS count, 
                    GROUP_CONCAT(CONCAT(s.firstname, ' ', s.surname) ORDER BY s.surname ASC SEPARATOR ' | ') AS members_list
                FROM Scholar s
                WHERE s.dept_id = ? AND s.sem_id = ?
            `;
            
            const [result] = await db.query(query, [dept.id, currentSemId]);
            const count = result[0].count || 0;
            const members = result[0].members_list || 'None';

            const memberNames = members.split(' | ');
            let memberListHtml = '<ul>';
            
            if (memberNames.length === 1 && memberNames[0] === 'None') {
                 memberListHtml += '<li>None</li>';
            } else {
                 memberNames.forEach(name => {
                    memberListHtml += `<li>${name}</li>`;
                 });
            }
            memberListHtml += '</ul>';

            htmlContent += `
                <div class="report-section">
                    <p class="dept-name">${dept.deptname}</p>
                    <p>Total Scholars: <span class="count">${count}</span></p>
                    <p><strong>Members List:</strong></p>
                    ${memberListHtml}
                </div>
            `;

            totalScholars += parseInt(count);
        }

        htmlContent += `
                <hr style="border: none; border-top: 1px solid #BDC3C7;">
                <h2>GRAND TOTAL SCHOLARS: ${totalScholars}</h2>
            </body>
            </html>
        `;

        // 3. Set headers for file download (Critical: application/msword and .doc extension)
        res.setHeader('Content-Type', 'application/msword');
        res.setHeader('Content-Disposition', 'attachment; filename="department_report.doc"');
        
        // 4. Send the formatted HTML content
        res.status(200).send(htmlContent);

    } catch (error) {
        console.error('Error generating department report Word file:', error);
        res.status(500).send('Failed to generate department report Word file.');
    }
});


// --- DOWNLOAD CHURCH REPORT (WORD .DOC DOCUMENT - FIX: s.church_id) ---
app.get('/api/report/download/church', async (req, res) => {
    if (!currentSem) {
        return res.status(500).send('Current semester not loaded.');
    }
    const currentSemId = currentSem.id;

    try {
        // 1. Fetch data from the database
        const [churches] = await db.query('SELECT id, chname FROM Church ORDER BY chname ASC');
        let totalScholars = 0;

        // 2. Start building the HTML content
        let htmlContent = `
            <html>
            <head>
                <meta charset="UTF-8">
                <title>Scholarship Church Report</title>
                <style>
                    body { font-family: Arial, sans-serif; max-width: 800px; margin: auto; }
                    h1 { color: #2C3E50; border-bottom: 3px solid #3498DB; padding-bottom: 10px; text-align: center; }
                    h2 { color: #16A085; text-align: center; }
                    .report-section { margin-bottom: 25px; border: 1px solid #ddd; padding: 15px; border-radius: 4px; }
                    .church-name { font-size: 1.3em; font-weight: bold; margin-bottom: 8px; color: #34495E; }
                    .count { color: #E67E22; font-weight: bold; }
                    ul { list-style-type: disc; padding-left: 20px; }
                    li { margin-bottom: 2px; }
                </style>
            </head>
            <body>
                <h1>Scholarship Church Report</h1>
                <p style="text-align: center;"><strong>Semester ID:</strong> ${currentSemId} | <strong>Date Generated:</strong> ${new Date().toLocaleDateString()}</p>
                <hr style="border: none; border-top: 1px solid #BDC3C7;">
        `;

        for (const church of churches) {
            const query = `
                SELECT 
                    COUNT(s.id) AS count, 
                    GROUP_CONCAT(CONCAT(s.firstname, ' ', s.surname) ORDER BY s.surname ASC SEPARATOR ' | ') AS members_list
                FROM Scholar s
                WHERE s.church_id = ? AND s.sem_id = ?  /* FIXED: Used s.church_id */
            `;
            
            const [result] = await db.query(query, [church.id, currentSemId]);
            const count = result[0].count || 0;
            const members = result[0].members_list || 'None';

            const memberNames = members.split(' | ');
            let memberListHtml = '<ul>';
            
            if (memberNames.length === 1 && memberNames[0] === 'None') {
                 memberListHtml += '<li>None</li>';
            } else {
                 memberNames.forEach(name => {
                    memberListHtml += `<li>${name}</li>`;
                 });
            }
            memberListHtml += '</ul>';
            
            htmlContent += `
                <div class="report-section">
                    <p class="church-name">${church.chname}</p>
                    <p>Total Scholars: <span class="count">${count}</span></p>
                    <p><strong>Members List:</strong></p>
                    ${memberListHtml}
                </div>
            `;

            totalScholars += parseInt(count);
        }

        htmlContent += `
                <hr style="border: none; border-top: 1px solid #BDC3C7;">
                <h2>GRAND TOTAL SCHOLARS: ${totalScholars}</h2>
            </body>
            </html>
        `;

        // 3. Set headers for file download (Critical: application/msword and .doc extension)
        res.setHeader('Content-Type', 'application/msword');
        res.setHeader('Content-Disposition', 'attachment; filename="church_report.doc"');
        
        // 4. Send the formatted HTML content
        res.status(200).send(htmlContent);

    } catch (error) {
        console.error('Error generating church report Word file:', error);
        res.status(500).send('Failed to generate church report Word file.');
    }
});


app.get('/api/report/department-members', async (req, res) => {
    if (!currentSem) return res.status(500).json({ success: false, message: 'Current semester not loaded.' });
    const currentSemId = currentSem.id;

    try {
        // 1. Get all departments
        const [departments] = await db.query('SELECT id, deptname FROM Department ORDER BY deptname ASC');

        const reportData = [];

        for (const dept of departments) {
            // FIX: Replaced s.fullname with CONCAT(s.firstname, ' ', s.surname)
            // Note: This endpoint uses ', ' separator for easy UI display array split
            const query = `
                SELECT 
                    COUNT(s.id) AS count, 
                    GROUP_CONCAT(CONCAT(s.firstname, ' ', s.surname) ORDER BY s.surname ASC SEPARATOR ', ') AS members_list
                FROM Scholar s
                WHERE s.dept_id = ? AND s.sem_id = ?
            `;
            
            const [result] = await db.query(query, [dept.id, currentSemId]);
            const count = result[0].count || 0;
            const members = result[0].members_list ? result[0].members_list.split(', ') : [];

            reportData.push({
                deptname: dept.deptname,
                count: parseInt(count),
                members: members
            });
        }

        res.json(reportData);
    } catch (error) {
        console.error('Error fetching department members report data:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch department members report data.' });
    }
});



app.get('/api/report/church-members', async (req, res) => {
    if (!currentSem) return res.status(500).json({ success: false, message: 'Current semester not loaded.' });
    const currentSemId = currentSem.id;

    try {
        // 1. Get all churches
        const [churches] = await db.query('SELECT id, chname FROM Church ORDER BY chname ASC');

        const reportData = [];

        for (const church of churches) {
            // FIX: Replaced s.fullname with CONCAT(s.firstname, ' ', s.surname)
            // Note: This endpoint uses ', ' separator for easy UI display array split
            const query = `
                SELECT 
                    COUNT(s.id) AS count, 
                    GROUP_CONCAT(CONCAT(s.firstname, ' ', s.surname) ORDER BY s.surname ASC SEPARATOR ', ') AS members_list
                FROM Scholar s
                WHERE s.church_id = ? AND s.sem_id = ? /* FIXED: Used s.church_id */
            `;
            
            const [result] = await db.query(query, [church.id, currentSemId]);
            const count = result[0].count || 0;
            const members = result[0].members_list ? result[0].members_list.split(', ') : [];

            reportData.push({
                chname: church.chname,
                count: parseInt(count),
                members: members
            });
        }

        res.json(reportData);
    } catch (error) {
        console.error('Error fetching church members report data:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch church members report data.' });
    }
});
//forgot pass

async function getUserDetails(user, currentSemId) {
    let name = 'Unknown User';
    let email = null;
    let table = null;

    // Check if it's a ScholarAdmin (Role ID 1 is not in the Users table)
    if (user.role_id === 1) {
        // Assuming user object here is from ScholarAdmin table query result
        name = `${user.firstname} ${user.surname}`;
        email = user.email;
        return { user_id: user.id, name, email, role_id: 1 };
    }

    // Map other role IDs to their respective tables
    switch (user.role_id) {
        case 2: table = 'Scholar'; break; // Scholar
        case 3: table = 'ChurchPersonnel'; break; // Church Personnel
        case 4: table = 'SchoPersonnel'; break; // Scho Personnel
        case 5: table = 'MonitoringInfo'; break; // Monitoring Personnel
        case 6: table = 'ValidatorInfo'; break; // Validator
        default: return null; // Unhandled role
    }

    // Query the corresponding info table for the name and email
    const [infoResults] = await db.query(
        `SELECT firstname, surname, email FROM ${table} WHERE user_id = ? AND sem_id = ?`,
        [user.id, currentSemId]
    );

    if (infoResults.length > 0) {
        const info = infoResults[0];
        name = `${info.firstname} ${info.surname}`;
        email = info.email;
        // Important: Use the Users.id as the final selection ID (user_id)
        return { user_id: user.id, name, email, role_id: user.role_id };
    }
    
    return null;
}

// ======================================
// 🔑 FORGOT PASSWORD: STEP 1 - FIND ACCOUNT(S)
// ======================================
app.post('/forgot-password-find', async (req, res) => {
    const { username } = req.body;
    
    // Check for current semester
    const currentSemId = currentSem ? currentSem.id : null;
    if (!currentSemId) {
        return res.status(503).json({ message: 'System error: Current active semester is not yet loaded or set.' });
    }
    
    try {
        let matchingAccounts = [];

        // 1. Check ScholarAdmin (Role ID 1) - Simple case, email/info in the same table
        const [adminResults] = await db.query(
            'SELECT id, firstname, surname, email, role_id, password FROM ScholarAdmin WHERE username = ?',
            [username]
        );

        if (adminResults.length > 0) {
            // Admin is always role_id 1
            const adminUser = adminResults[0];
            matchingAccounts.push({ 
                id: adminUser.id, // Primary key for ScholarAdmin
                name: `${adminUser.firstname} ${adminUser.surname}`,
                role_id: 1 
            });
        }
        
        // 2. Check all other Users in the current semester
        const [userResults] = await db.query(
            'SELECT id, role_id FROM Users WHERE username = ? AND sem_id = ?',
            [username, currentSemId]
        );
        
        // Loop through Users table results
        for (const user of userResults) {
            const accountDetails = await getUserDetails(user, currentSemId);
            if (accountDetails) {
                // For non-Admin accounts, the 'user_id' is the Users.id which is required for the next step.
                matchingAccounts.push({ 
                    user_id: accountDetails.user_id,
                    name: accountDetails.name,
                    role_id: accountDetails.role_id
                });
            }
        }

        if (matchingAccounts.length === 0) {
            return res.status(404).json({ message: 'No active account found with that username for the current semester.' });
        }

        // Return the list of accounts found
        res.json({ accounts: matchingAccounts });

    } catch (err) {
        console.error('Error in forgot password find:', err);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
});

// ======================================
// 🔑 FORGOT PASSWORD: STEP 2 - SEND PASSWORD
// ======================================
app.post('/forgot-password-send', async (req, res) => {
    // Note: The userId passed here is the ID used in the login process:
    // - ScholarAdmin.id for Role 1
    // - Users.id for Roles 2-6
    const { userId } = req.body;
    
    if (!userId) {
        return res.status(400).json({ message: 'Missing user ID.' });
    }
    
    const currentSemId = currentSem ? currentSem.id : null;
    if (!currentSemId) {
        return res.status(503).json({ message: 'System error: Current active semester is not yet loaded or set.' });
    }

    let userDetails = null;
    let accountName = 'User';
    let accountEmail = null;
    let accountPassword = null;
    let roleId = null;

    try {
        // 1. Check ScholarAdmin (Role ID 1)
        const [adminResults] = await db.query(
            'SELECT password, firstname, surname, email, role_id FROM ScholarAdmin WHERE id = ?',
            [userId]
        );

        if (adminResults.length > 0) {
            const admin = adminResults[0];
            accountName = `${admin.firstname} ${admin.surname}`;
            accountEmail = admin.email;
            accountPassword = admin.password; // Hashed password
            roleId = admin.role_id;
        } else {
            // 2. Check other Users (Roles 2-6)
            const [userResults] = await db.query(
                'SELECT id, password, role_id FROM Users WHERE id = ? AND sem_id = ?',
                [userId, currentSemId]
            );

            if (userResults.length > 0) {
                const user = userResults[0];
                accountPassword = user.password; // Hashed password
                roleId = user.role_id;
                
                // Get details from the linked table
                userDetails = await getUserDetails(user, currentSemId);
                
                if (userDetails) {
                    accountName = userDetails.name;
                    accountEmail = userDetails.email;
                }
            }
        }
        
        
        if (!accountEmail || !accountPassword) {
            return res.status(404).json({ message: 'Account not found or missing email address.' });
        }
        
        
        const otp = Math.floor(100000 + Math.random() * 900000); // 6-digit number
        const newHashedPassword = await bcrypt.hash(otp.toString(), 10);
        
        if (roleId === 1) {
            // Update ScholarAdmin table
            await db.query('UPDATE ScholarAdmin SET password = ?, otp = ? WHERE id = ?', [newHashedPassword, otp, userId]);
        } else if (roleId >= 2 && roleId <= 6) {
            // Update Users table
            await db.query('UPDATE Users SET password = ?, otp = ? WHERE id = ?', [newHashedPassword, otp, userId]);
        } else {
             return res.status(400).json({ message: 'Invalid role for password reset.' });
        }

        // Send Email with the OTP
        if (typeof transporter !== 'undefined') {
            const subject = `Password Reset Request - One-Time Password (OTP)`;
            const mailOptions = {
                from: 'your.application.email@gmail.com', // Change this!
                to: accountEmail,
                subject: subject,
                html: `
                    <p>Dear ${accountName},</p>
                    <p>You requested a password reset for your account.</p>
                    <p>Please use the **One-Time Password (OTP)** below to log in:</p>
                    <div style="padding: 15px; background-color: #f1f1f1; border-left: 5px solid var(--primary-color); margin: 20px 0; font-size: 1.5rem; font-weight: 600;">
                        ${otp}
                    </div>
                    <p>This OTP has replaced your old password. Please use it to log in and then **immediately change your password** once you access your dashboard.</p>
                    <p>If you did not request a password reset, you can safely ignore this email. Your new password is now the OTP above.</p>
                    <p>Thank you,</p>
                    <p>System Administration</p>
                `
            };

            await transporter.sendMail(mailOptions);
            console.log(`✅ Password reset (OTP) email sent to ${accountEmail} for user ID ${userId}.`);
            
            // Adjust the success message for the user.
            return res.json({ message: 'A One-Time Password (OTP) has been sent to your registered email. Please use it to log in and change your password immediately.' });

        } else {
            // If transporter is not set up, revert the password change
            // (You'd need to save the old password before hashing the new one, or simply alert the admin)
            console.error('⚠️ Email transporter not configured. Cannot send password reset email.');
            return res.status(500).json({ message: 'Email service is unavailable. Please contact the administrator.' });
        }
        
    } catch (err) {
        console.error('Error in forgot password send:', err);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
});

//registrar
// --- 1. SEND ADMIN ACTION OTP ---
// --- 1. SEND ADMIN ACTION OTP (CORRECTED) ---
app.post('/send-admin-action-otp', async (req, res) => {
    // Check if the user is a Registrar (role_id = 7)
    // NOTE: Ensure your login process correctly sets role_id = 7 for RegistrarHead
    if (!req.session.loggedIn || req.session.user.role_id !== 7) {
        return res.status(401).send('Unauthorized. Only Registrars can perform this action.');
    }

    const registrarId = req.session.user.id;

    try {
        // 👇 CORRECTED: Fetch Registrar's email from the RegistrarHead table
        const [results] = await db.query('SELECT email FROM RegistrarHead WHERE id = ?', [registrarId]);
        
        if (results.length === 0) {
            // This is the source of the "Registrar not found" error
            return res.status(404).send('Registrar (Head) account not found in the RegistrarHead table.');
        }

        const registrarEmail = results[0].email;
        if (!registrarEmail) {
            return res.status(400).send('Your email is not set in the RegistrarHead table. Cannot send OTP.');
        }

        // Generate OTP and set expiry (5 minutes)
        const otp = Math.floor(100000 + Math.random() * 900000);
        req.session.adminActionOTP = otp;
        req.session.adminActionOtpExpiry = Date.now() + 5 * 60 * 1000;

        const mailOptions = {
            from: 'scholarshipdept.grc@gmail.com',
            to: registrarEmail,
            subject: 'Admin Action Confirmation OTP',
            text: `Your OTP for confirming the Scholar Admin action is: ${otp}. This OTP is valid for 5 minutes.`
        };

        await transporter.sendMail(mailOptions);
        res.status(200).send('OTP sent to your registered email.');
    } catch (error) {
        console.error('Error sending Admin Action OTP email:', error);
        res.status(500).send('Failed to send OTP. Please try again.');
    }
});


// --- 2. VERIFY ADMIN ACTION OTP AND EXECUTE ACTION ---
app.post('/verify-admin-action-otp', async (req, res) => {
    const { otp, action, data } = req.body;
    const sessionOTP = req.session.adminActionOTP;
    const otpExpiry = req.session.adminActionOtpExpiry;

    // Check session/expiry
    if (!sessionOTP || Date.now() > otpExpiry) {
        return res.status(400).json({ success: false, message: 'OTP is expired or not set. Please request a new one.' });
    }
    
    // Check OTP match
    if (otp !== String(sessionOTP)) {
        return res.status(400).json({ success: false, message: 'Invalid OTP.' });
    }

    // Clear OTP from session upon successful verification
    delete req.session.adminActionOTP;
    delete req.session.adminActionOtpExpiry;

    try {
        if (action === 'create_admin') {
            const { surname, firstname, email } = data;
            const role_id = 1; // Scholar Admin Role ID
            const role = 'admin';

            // Generate account details
            const username = `${role}${surname}`;
            const randomPassPart = generateRandomPasswordPart();
            const plainPassword = `${surname}${randomPassPart}`;
            const hashedPassword = await bcrypt.hash(plainPassword, 10);
            
            const profile = null;
            const status = 'active';
            const otp_column = null; // Storing as 'otp' because of the column name

            // Check for existing user (optional but recommended)
            const [existingUser] = await db.query('SELECT id FROM ScholarAdmin WHERE username = ? OR email = ?', [username, email]);
            if (existingUser.length > 0) {
                 // The old OTP is cleared, but we should not proceed.
                 return res.status(409).json({ success: false, message: 'Account with this username or email already exists.' });
            }

            // Insert new Admin
            await db.query(
                'INSERT INTO ScholarAdmin (surname, firstname, email, username, password, role_id, profile, status, otp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [surname, firstname, email, username, hashedPassword, role_id, profile, status, otp_column]
            );

            // Send Email to the new Admin
            const mailOptions = {
                from: 'scholarshipdept.grc@gmail.com',
                to: email,
                subject: 'New Scholar Admin Account Created',
                text: `Hello ${firstname},\n\nYour Scholar Admin account has been successfully created by the Registrar.\n\nUsername: ${username}\nPassword: ${plainPassword}\n\nPlease log in and change your password immediately for security.\n\nNote: Your current status is 'Active'.`
            };
            await transporter.sendMail(mailOptions);
            
            res.json({ success: true, message: 'OTP verified. Scholar Admin account created and email sent.' });

        } else if (action === 'update_status') {
            const { adminId, newStatus } = data;

            // Fetch current email for notification
            const [adminResult] = await db.query('SELECT email, firstname, surname FROM ScholarAdmin WHERE id = ?', [adminId]);
            if (adminResult.length === 0) {
                 // The old OTP is cleared, but we should not proceed.
                 return res.status(404).json({ success: false, message: 'Admin account not found for update.' });
            }
            const { email, firstname, surname } = adminResult[0];

            // Update status
            await db.query('UPDATE ScholarAdmin SET status = ? WHERE id = ?', [newStatus, adminId]);

            // Send Email to the Admin about the status change
            const subject = newStatus === 'active' ? 'Account Activated' : 'Account Deactivated';
            const bodyText = `Hello ${firstname} ${surname},\n\nYour Scholar Admin account status has been updated by the Registrar.\n\n**New Status: ${newStatus.toUpperCase()}**\n\nIf you have any questions, please contact the Registrar's office.`;
            
            const mailOptions = {
                from: 'scholarshipdept.grc@gmail.com',
                to: email,
                subject: subject,
                text: bodyText
            };
            await transporter.sendMail(mailOptions);

            res.json({ success: true, message: `OTP verified. Admin status updated to ${newStatus}. Notification emailed.` });

        } else {
             // The old OTP is cleared, but we should not proceed.
            return res.status(400).json({ success: false, message: 'Invalid action specified.' });
        }
    } catch (error) {
        console.error('Error executing admin action:', error);
        // The OTP is cleared, but the action failed.
        res.status(500).json({ success: false, message: `Server error during action: ${error.message}` });
    }
});


// --- 3. FETCH SCHOLAR ADMIN ACCOUNTS ---
app.get('/scholar-admin-accounts', async (req, res) => {
    // Check if the user is a Registrar (role_id = 7)
    if (!req.session.loggedIn || req.session.user.role_id !== 7) {
        return res.status(401).json({ message: 'Unauthorized.' });
    }

    try {
        // Fetch all Scholar Admin accounts (role_id = 1)
        const [accounts] = await db.query('SELECT id, surname, firstname, email, username, status FROM ScholarAdmin WHERE role_id = 1');
        res.json(accounts);
    } catch (error) {
        console.error('Error fetching admin accounts:', error);
        res.status(500).json({ message: 'Failed to fetch admin accounts.' });
    }
});

//initial setup
// New Endpoint 1: Check Semester Status
app.get('/api/check-semester-status', async (req, res) => {
    // Check if the current user is an Admin (role_id = 1)
    if (!req.session.loggedIn || req.session.user.role_id !== 1) {
        return res.status(401).json({ message: 'Unauthorized' });
    }

    try {
        // Query the Semester table to see if any semester exists
        const [results] = await db.query('SELECT COUNT(id) AS count FROM Semester');
        const semesterSet = results[0].count > 0;
        
        res.status(200).json({ semesterSet });
    } catch (error) {
        console.error('Error checking semester status:', error);
        res.status(500).json({ message: 'Server error checking semester status.' });
    }
});

// New Endpoint 2: Initial Semester Setup and Scholar Batch Upload
app.post('/api/initial-semester-setup', uploadExcel.single('scholarsFile'), async (req, res) => {
    if (!req.session.loggedIn || req.session.user.role_id !== 1) {
        return res.status(401).json({ message: 'Unauthorized' });
    }

    const { semNameInput } = req.body;
    if (!semNameInput || !req.file) {
        return res.status(400).json({ message: 'Missing semester name or scholar file.' });
    }

    const currentDate = new Date().toISOString().split('T')[0];
    
    // Atomicity is crucial here: Use a transaction
    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
        // 1. POPULATE SEMESTER TABLE
        const semesterQuery = `
            INSERT INTO Semester (semname, datestart, dateend, gratis, fellowship, sService, penalty)
            VALUES (?, ?, ?, 1, 1, 1, 1)
        `;
        const [semResult] = await connection.query(semesterQuery, [semNameInput, currentDate, currentDate]);
        const temporarilySetSemesterId = semResult.insertId;

        // Read Excel File
        const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = xlsx.utils.sheet_to_json(worksheet);

        const results = [];
        
        for (const row of jsonData) {
            // Corrected Excel Key Mapping and Normalization
            const surname = String(row.Surname || '').trim();
            const firstname = String(row.Firstname || '').trim();
            const email = String(row.Email || '').trim().toLowerCase();
            const renew = parseInt(row.Renew, 10) || 0; 
            const yearLevel = String(row['year level'] || '').trim();
            let course = String(row.course || '').trim().toUpperCase();
            const schoLevel = parseInt(row['scho level'], 10) || null;

            if (!surname || !firstname || !email || !yearLevel || !course) {
                results.push({ success: false, message: `Skipped: Incomplete data for a row. Surname: ${surname}, Firstname: ${firstname}` });
                continue;
            }

            // **TRANSACTION START FOR ONE SCHOLAR**
            try {
                // 2. POPULATE USERS TABLE
                const username = 'scholar' + surname.toLowerCase().replace(/[^a-z0-9]/g, '');
                const plainPassword = surname + generateRandomPasswordPart();
                
                // 🛑 CRITICAL FIX: Hash the password using bcrypt
                const hashedPassword = await bcrypt.hash(plainPassword, 10);
                
                const userQuery = `
                    INSERT INTO Users (username, password, role_id, status, sem_id, otp)
                    VALUES (?, ?, 2, NULL, ?, NULL)
                `;
                const [userResult] = await connection.query(userQuery, [username, hashedPassword, temporarilySetSemesterId]);
                const tempo_user_id = userResult.insertId;

                // 3. POPULATE SCHOLAR TABLE
                const scholarQuery = `
                    INSERT INTO Scholar (surname, firstname, email, yearLevel, course, user_id, schoLevel, sem_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `;
                const [scholarResult] = await connection.query(scholarQuery, [
                    surname, firstname, email, yearLevel, course, tempo_user_id, schoLevel, temporarilySetSemesterId
                ]);
                const tempo_sch_id = scholarResult.insertId;

                // 4. POPULATE CERTIFICATERECIPIENT TABLE
                const certQuery = `
                    INSERT INTO CertificateRecipient (sch_id, surname, firstname, user_id, dateReceived, renew, sem_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `;
                await connection.query(certQuery, [
                    tempo_sch_id, surname, firstname, tempo_user_id, currentDate, renew, temporarilySetSemesterId
                ]);

                // Optionally, send account details email here using plainPassword
                // ... (Email logic)
                
                results.push({ 
                    success: true, 
                    message: `Scholar ${firstname} ${surname} created.`, 
                    username: username, 
                    password: plainPassword // WARNING: LOGGING/RETURNING PLAIN PASSWORDS IS FOR TESTING ONLY!
                });

            } catch (scholarError) {
                console.error(`Error processing scholar ${firstname} ${surname}:`, scholarError);
                results.push({ success: false, message: `DB error for ${firstname} ${surname}.` });
                throw scholarError;
            }
        }

        // Commit the transaction
        await connection.commit();
        connection.release();

        const successCount = results.filter(r => r.success).length;
        const failCount = results.filter(r => !r.success).length;
        
        res.status(200).json({
            message: `Semester '${semNameInput}' set successfully. ${successCount} scholars imported. ${failCount} failed.`,
            details: results
        });

    } catch (error) {
        // Rollback on any error
        await connection.rollback();
        connection.release();
        console.error('Initial Semester Setup Transaction Failed:', error);
        // Include a clearer error message for the client
        res.status(500).json({ message: 'Failed to complete semester setup and scholar import. Check console for DB errors.' });
    }
});

app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ message: 'File size limit exceeded. Max 5MB allowed.' });
        }
    } else if (err) {
        return res.status(400).json({ message: err.message });
    }
    next();
});

// ✅ AUTO DISTRIBUTION FUNCTION
async function distributeScholarsToChurchPersonnel(semId) {
    if (!semId) {
        console.error("Distribution failed: Semester ID (semId) is not set.");
        return;
    }

    console.log(`\n📘 Starting scholar distribution for Semester ID: ${semId}`);

    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();

        // Step 1: Find all churches that have active Church Personnel and unassigned Scholars
        const [churchResults] = await connection.query(`
            SELECT DISTINCT s.church_id
            FROM Scholar s
            JOIN ChurchPersonnel cp ON s.church_id = cp.church_id
            WHERE s.sem_id = ? AND cp.sem_id = ?
            AND (s.church_personnel_id IS NULL OR s.church_personnel_id = 0)
        `, [semId, semId]);

        if (churchResults.length === 0) {
            console.log("No unassigned scholars found this semester.");
            await connection.commit();
            return;
        }

        const summary = [];

        // Step 2: Process each church
        for (const { church_id } of churchResults) {
            console.log(`\n🏛️ Processing Church ID: ${church_id}`);

            // Get active Church Personnel for this church and semester
            const [personnel] = await connection.query(`
                SELECT id FROM ChurchPersonnel 
                WHERE church_id = ? AND sem_id = ? ORDER BY id ASC
            `, [church_id, semId]);

            if (personnel.length === 0) {
                console.warn(`⚠️ Church ${church_id}: No personnel available. Skipping.`);
                continue;
            }

            // Get unassigned Scholars for this church and semester
            const [scholars] = await connection.query(`
                SELECT id FROM Scholar
                WHERE church_id = ? AND sem_id = ? 
                AND (church_personnel_id IS NULL OR church_personnel_id = 0)
                ORDER BY id ASC
            `, [church_id, semId]);

            if (scholars.length === 0) {
                console.log(`✅ Church ${church_id}: No unassigned scholars.`);
                continue;
            }

            // Distribute scholars evenly using round-robin
            const personnelIds = personnel.map(p => p.id);
            const scholarIds = scholars.map(s => s.id);
            const personnelCount = personnelIds.length;

            const updatePromises = [];

            for (let i = 0; i < scholarIds.length; i++) {
                const scholarId = scholarIds[i];
                const assignedPersonnelId = personnelIds[i % personnelCount];
                updatePromises.push(
                    connection.execute(`
                        UPDATE Scholar
                        SET church_personnel_id = ?
                        WHERE id = ? AND church_id = ? AND sem_id = ?
                    `, [assignedPersonnelId, scholarId, church_id, semId])
                );
            }

            await Promise.all(updatePromises);

            console.log(`✅ Church ${church_id}: Assigned ${scholarIds.length} scholars to ${personnelCount} personnel.`);
            summary.push({
                church_id,
                assigned_scholars: scholarIds.length,
                personnel_count: personnelCount
            });
        }

        await connection.commit();
        console.log("\n🎯 Scholar distribution completed successfully.");
        return { success: true, summary };

    } catch (error) {
        if (connection) await connection.rollback();
        console.error("❌ Error during scholar distribution:", error);
        return { success: false, message: "Distribution failed. Transaction rolled back." };
    } finally {
        if (connection) connection.release();
    }
}

(async () => {
  await fetchLatestSemester(); // ✅ load the semester first!

  if (currentSem && currentSem.id) {
    await distributeScholarsToChurchPersonnel(currentSem.id);
  } else {
    console.error("⚠️ Cannot start distribution — currentSem is null or invalid:", currentSem);
  }
})();





app.listen(port, () => console.log(`Server running on port ${port}`));
