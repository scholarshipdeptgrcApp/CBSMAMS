// Utility Functions
function openModal(modalId) {
    document.getElementById(modalId).style.display = "block";
}

function closeModal(modalId) {
    document.getElementById(modalId).style.display = "none";
}

// Add these functions to adminDash.js
function openCustomModal(modalId) {
    document.getElementById(modalId).style.display = "block";
}

function closeCustomModal(modalId) {
    document.getElementById(modalId).style.display = "none";
}

function toggleMenu() {
    document.getElementById("dropdown-menu").classList.toggle("show-menu");
}

// CLOSE DROPDOWN/MODALS
window.onclick = function(event) {
    if (!event.target.matches('.hamburger, .hamburger div')) {
        const dropdowns = document.getElementsByClassName("menu-dropdown");
        for (let i = 0; i < dropdowns.length; i++) {
            const openDropdown = dropdowns[i];
            if (openDropdown.classList.contains('show-menu')) {
                openDropdown.classList.remove('show-menu');
            }
        }
    }

    if (event.target.classList.contains('modal')) {
        event.target.style.display = "none";
    }
};


// Initial page load setup
document.addEventListener('DOMContentLoaded', () => {
    fetchUserProfile();
});

//PROFILE
async function fetchUserProfile() {
    try {
        const response = await fetch('/profile');
        if (response.ok) {
            const profileData = await response.json();

            const profileEmailElement = document.getElementById('profileEmail');
            if (profileEmailElement) {
                profileEmailElement.textContent = profileData.email || 'No email set';
            }

            const profilePicElement = document.getElementById('profile-pic');
            const modalProfilePicElement = document.getElementById('modalProfilePic');

            if (profileData.profile && profilePicElement && modalProfilePicElement) {
                const blob = new Blob([new Uint8Array(profileData.profile.data)], {
                    type: 'image/jpeg'
                });
                const imageUrl = URL.createObjectURL(blob);
                profilePicElement.src = imageUrl;
                modalProfilePicElement.src = imageUrl;
            }
        } else {
            console.error('Failed to fetch user profile:', response.statusText);
        }
    } catch (error) {
        console.error('Error fetching profile:', error);
    }
}

document.getElementById('uploadProfilePicForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData();
    const fileInput = document.getElementById('file-upload');
    if (fileInput.files.length > 0) {
        formData.append('profilePicture', fileInput.files[0]);
        const response = await fetch('/upload-profile-picture', {
            method: 'POST',
            body: formData,
        });
        const result = await response.text();
        if (response.ok) {
            alert(result);
            closeModal('profileModal');
            fetchUserProfile();
        } else {
            alert(result);
        }
    } else {
        alert('Please select a file.');
    }
});

// --- NEW UTILITY FUNCTIONS ---

// Function to send the OTP and open the modal
async function sendOtpForSecurity(action, data) {
    // 1. Send OTP Request
    const sendOtpResponse = await fetch('/send-security-otp', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        }
    });

    if (!sendOtpResponse.ok) {
        const errorText = await sendOtpResponse.text();
        return alert(`Failed to send OTP: ${errorText}`);
    }

    // 2. Open OTP Modal and Set Data
    document.getElementById('otpAction').value = action;
    document.getElementById('otpData').value = JSON.stringify(data); // Store data to use after verification
    document.getElementById('securityOtpInput').value = ''; // Clear previous OTP
    document.getElementById('securityOtpMessage').textContent = 'OTP sent to your email. It is valid for 5 minutes.';

    openModal('securityOtpModal');
}

// Function to handle the actual verification
async function handleSecurityOtpVerification(otp, action, data) {
    const dataObj = JSON.parse(data); // Get the stored data

    const verifyResponse = await fetch('/verify-security-otp', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ otp, action, data: dataObj }) // Send OTP, action, and data
    });

    const result = await verifyResponse.json();
    const messageElement = document.getElementById('securityOtpMessage');

    if (verifyResponse.ok) {
        messageElement.textContent = result.message;
        
        // Final action depends on what was verified
        if (action === 'email') {
            closeModal('securityOtpModal');
            closeModal('profileModal');
            alert('Email updated successfully.');
            fetchUserProfile(); // Refresh user info
        } else if (action === 'password') {
            closeModal('securityOtpModal');
            closeModal('profileModal');
            alert('Password updated successfully. Please note you may need to re-login.');
        }
    } else {
        // Verification failed
        messageElement.textContent = result.message;
    }
}


// --- OTP Verification Form Submission Handler ---
document.getElementById('securityOtpForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const otp = document.getElementById('securityOtpInput').value;
    const action = document.getElementById('otpAction').value;
    const data = document.getElementById('otpData').value;
    
    // Disable button to prevent double-click
    const submitBtn = e.submitter;
    submitBtn.disabled = true;
    
    await handleSecurityOtpVerification(otp, action, data);
    
    // Re-enable button
    submitBtn.disabled = false;
});


// --- UPDATED CHANGE EMAIL FORM SUBMISSION ---
document.getElementById('changeEmailForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const newEmail = document.getElementById('newEmail').value;
    
    // Instead of directly updating, send OTP
    await sendOtpForSecurity('email', { newEmail });
});


// --- UPDATED CHANGE PASS FORM SUBMISSION ---
document.getElementById('changePasswordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const currentPassword = document.getElementById('currentPassword').value;
    const newPassword = document.getElementById('newPassword').value;
    
    // Instead of directly updating, send OTP
    await sendOtpForSecurity('password', { currentPassword, newPassword });
});
// SHOWHIDE PASSWORD
function togglePasswordVisibility(inputId, iconElement) {
    const passwordInput = document.getElementById(inputId);
    const icon = iconElement.querySelector('i');
    if (passwordInput.type === 'password') {
        passwordInput.type = 'text';
        icon.classList.remove('fa-eye');
        icon.classList.add('fa-eye-slash');
    } else {
        passwordInput.type = 'password';
        icon.classList.remove('fa-eye-slash');
        icon.classList.add('fa-eye');
    }
}

// --- NEW OTP UTILITY FUNCTIONS FOR ADMIN ACTIONS ---

/**
 * Sends an OTP to the currently logged-in Registrar for security.
 * @param {string} action - The action being performed ('create_admin' or 'update_status').
 * @param {object} data - The data associated with the action (e.g., admin details or account ID/status).
 */
async function sendOtpForAdminAction(action, data) {
    document.getElementById('adminSecurityOtpMessage').textContent = 'Sending OTP...';

    // 1. Send OTP Request
    const sendOtpResponse = await fetch('/send-admin-action-otp', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        // Optionally send a hint to the server about the action
        body: JSON.stringify({ action }) 
    });

    if (!sendOtpResponse.ok) {
        const errorText = await sendOtpResponse.text();
        document.getElementById('adminSecurityOtpMessage').textContent = `Failed to send OTP: ${errorText}`;
        return alert(`Failed to send OTP: ${errorText}`);
    }

    // 2. Open OTP Modal and Set Data
    document.getElementById('adminOtpAction').value = action;
    // Store data to use after verification. If data includes sensitive info (like password), it should be generated and stored server-side/session after OTP verification starts. Here we store the inputs.
    document.getElementById('adminOtpData').value = JSON.stringify(data); 
    document.getElementById('adminSecurityOtpInput').value = ''; // Clear previous OTP
    document.getElementById('adminSecurityOtpMessage').textContent = 'OTP sent to your email. It is valid for 5 minutes.';

    closeModal('createAdminModal'); // Close the initial modal if it was open
    closeModal('adminAccountsModal'); // Close the initial modal if it was open
    openModal('adminSecurityOtpModal');
}

/**
 * Handles the actual OTP verification and final administrative action.
 */
async function handleAdminOtpVerification(otp, action, data) {
    const dataObj = JSON.parse(data); 
    const messageElement = document.getElementById('adminSecurityOtpMessage');

    const verifyResponse = await fetch('/verify-admin-action-otp', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ otp, action, data: dataObj }) 
    });

    const result = await verifyResponse.json();

    if (verifyResponse.ok) {
        messageElement.textContent = result.message;
        
        if (action === 'create_admin') {
            closeModal('adminSecurityOtpModal');
            document.getElementById('createAdminForm').reset(); // Clear form
            alert('Scholar Admin created successfully! Credentials emailed to the admin.');
        } else if (action === 'update_status') {
            closeModal('adminSecurityOtpModal');
            alert('Admin status updated successfully! Email notification sent.');
            // Re-fetch and display the accounts to show the updated status
            await fetchAdminAccounts(); 
            openModal('adminAccountsModal');
        }
    } else {
        messageElement.textContent = result.message;
        // If verification fails, revert the switch state if it was an update_status action
        if (action === 'update_status' && dataObj.adminId && dataObj.oldStatus) {
            const switchElement = document.getElementById(`status-switch-${dataObj.adminId}`);
            if (switchElement) {
                switchElement.checked = dataObj.oldStatus === 'active';
            }
        }
    }
}


// --- NEW OTP Verification Form Submission Handler ---
document.getElementById('adminSecurityOtpForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const otp = document.getElementById('adminSecurityOtpInput').value;
    const action = document.getElementById('adminOtpAction').value;
    const data = document.getElementById('adminOtpData').value;
    
    // Disable button to prevent double-click
    const submitBtn = e.submitter;
    submitBtn.disabled = true;
    
    await handleAdminOtpVerification(otp, action, data);
    
    // Re-enable button
    submitBtn.disabled = false;
});


// --- CREATE ADMIN BUTTON HANDLER ---
document.getElementById('createAdminBtn').addEventListener('click', () => {
    document.getElementById('createAdminForm').reset();
    openModal('createAdminModal');
});

// --- CREATE ADMIN FORM SUBMISSION ---
document.getElementById('createAdminForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const surname = document.getElementById('adminSurname').value.trim();
    const firstname = document.getElementById('adminFirstname').value.trim();
    const email = document.getElementById('adminEmail').value.trim();

    if (!surname || !firstname || !email) {
        return alert('All fields are required.');
    }

    // 1. Gather all data for the new admin
    const newAdminData = { surname, firstname, email };

    // 2. Initiate OTP process for security
    await sendOtpForAdminAction('create_admin', newAdminData);
});


// --- ADMIN ACCOUNTS BUTTON HANDLER ---
document.getElementById('adminAccountsBtn').addEventListener('click', async () => {
    openModal('adminAccountsModal');
    await fetchAdminAccounts();
});

/**
 * Fetches and displays all Scholar Admin accounts.
 */
async function fetchAdminAccounts() {
    const tableBody = document.querySelector('#adminAccountsTable tbody');
    const messageElement = document.getElementById('adminAccountsMessage');
    tableBody.innerHTML = '<tr><td colspan="6">Loading admin accounts...</td></tr>';
    messageElement.textContent = '';

    try {
        const response = await fetch('/scholar-admin-accounts');
        const data = await response.json();

        if (!response.ok) {
            tableBody.innerHTML = `<tr><td colspan="6" style="color: red;">Error: ${data.message || 'Failed to fetch accounts.'}</td></tr>`;
            return;
        }

        tableBody.innerHTML = ''; // Clear loading message

        if (data.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="6">No Scholar Admin accounts found.</td></tr>';
            return;
        }

        data.forEach(admin => {
            const row = tableBody.insertRow();
            row.innerHTML = `
                <td>${admin.id}</td>
                <td>${admin.firstname} ${admin.surname}</td>
                <td>${admin.email}</td>
                <td>${admin.username}</td>
                <td><span style="color: ${admin.status === 'active' ? '#00BFFF' : '#FF6347'}; font-weight: bold;">${admin.status.toUpperCase()}</span></td>
                <td>
                    <label class="switch">
                        <input type="checkbox" 
                               id="status-switch-${admin.id}" 
                               ${admin.status === 'active' ? 'checked' : ''}
                               onchange="handleStatusChange(${admin.id}, this.checked, '${admin.status}')">
                        <span class="slider round"></span>
                    </label>
                </td>
            `;
        });

    } catch (error) {
        console.error('Error fetching admin accounts:', error);
        tableBody.innerHTML = '<tr><td colspan="6" style="color: red;">An unexpected error occurred.</td></tr>';
    }
}

/**
 * Handles the click on the status switch, initiating the OTP process.
 * @param {number} adminId - The ID of the admin account to change.
 * @param {boolean} isChecked - The new desired status (true for active, false for inactive).
 * @param {string} oldStatus - The current status (used for rollback if OTP fails).
 */
function handleStatusChange(adminId, isChecked, oldStatus) {
    const newStatus = isChecked ? 'active' : 'inactive';
    const switchElement = document.getElementById(`status-switch-${adminId}`);
    
    // Prevent immediate change. The actual change happens after OTP verification.
    // If the old status is active and new is inactive, we need to temporarily uncheck it 
    // to force the user to verify the action. We'll rely on the server response to fix the UI.

    // If the status is the same, do nothing. This shouldn't happen with the onchange, but as a safeguard.
    if (newStatus === oldStatus) return;

    // We must revert the UI switch state immediately because we need OTP for the change.
    // If we don't revert, the UI is misleading until the OTP process is done.
    switchElement.checked = oldStatus === 'active'; 

    const data = {
        adminId: adminId,
        newStatus: newStatus,
        oldStatus: oldStatus // Store old status for potential rollback
    };
    
    sendOtpForAdminAction('update_status', data);
}

// NOTE: Ensure openModal, closeModal, and other utility functions are present and correct.
// The provided utility functions look fine.