function toggleMenu() {
    const dropdownMenu = document.getElementById("dropdown-menu");
    dropdownMenu.classList.toggle("show-menu");
}
let manualSearchModalResults = [];
let mediaStream = null;
let scanner = null;
let currentScholarData = null;



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
async function openModal(modalId) {
    document.getElementById(modalId).style.display = 'flex';
    
    // Disable background scroll when modal is open
    document.body.classList.add('modal-open');
    
    if (modalId === 'qrScannerModal') {
        const video = document.getElementById('qr-video');
        const status = document.getElementById('scanner-status');
        status.textContent = 'Initializing scanner...';
        video.srcObject = null;

        scanner = new Instascan.Scanner({
            video: video,
            scanPeriod: 5
        });

        scanner.addListener('scan', function (content) {
            console.log("QR Code Scanned:", content);
            scanner.stop();
            status.textContent = 'QR Code detected. Sending data...';
            sendScannedDataToServer(content);
        });

        try {
            const cameras = await Instascan.Camera.getCameras();
            if (cameras.length > 0) {
                const backCamera = cameras.find(c => c.name.toLowerCase().includes('back') || c.name.toLowerCase().includes('environment'));
                const cameraToUse = backCamera || cameras[0];
                await scanner.start(cameraToUse);
                status.textContent = 'Camera ready. Center a QR code to scan.';
                if (video.srcObject) mediaStream = video.srcObject;
            } else {
                status.textContent = 'No cameras found on this device.';
                console.error('No cameras found.');
            }
        } catch (err) {
            console.error("Error accessing camera with Instascan: ", err);
            status.textContent = 'Camera error: ' + (err.name || 'Unknown Error');
        }
    }
}

function closeModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
    
    // Re-enable scroll when modal closes
    document.body.classList.remove('modal-open');

    if (modalId === 'qrScannerModal') {
        if (scanner) {
            scanner.stop().catch(e => console.error("Error stopping scanner:", e));
            scanner = null;
        }
        if (mediaStream) {
            mediaStream.getTracks().forEach(track => track.stop());
            mediaStream = null;
        }
        document.getElementById('qr-video').srcObject = null;
        document.getElementById('scanner-status').textContent = 'Scanner closed.';
    }
}

// Send scanned QR data
async function sendScannedDataToServer(qrCodeContent) {
    try {
        const response = await fetch('/fellowship-scan-qr-code', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ qrData: qrCodeContent }),
        });

        const result = await response.json();

        document.getElementById('scanner-status').textContent = result.message || '';

        if (response.ok) {
            displayScholarInfoModal(result.data);
        } else {
            closeModal('qrScannerModal');
            alert('Scan failed: ' + result.message);
        }

    } catch (error) {
        console.error('Error sending scanned data to server:', error);
        document.getElementById('scanner-status').textContent = 'Communication Error: Check server connection.';
        closeModal('qrScannerModal');
        alert('A network error occurred.');
    }
}
function showSuccessPopup(message) {
    if (message && message.trim() !== '') {
        const successPopup = document.getElementById('successPopup');
        const successMessage = document.getElementById('successMessage');
        successMessage.textContent = message;
        successPopup.style.display = 'flex';
    }
}
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

function closePopup() {
    const successPopup = document.getElementById('successPopup');
    successPopup.style.display = 'none';
}
// Replace the existing displayScholarInfoModal in chPersonnelDash.js
function displayScholarInfoModal(data) {
    currentScholarData = data; // Save the data globally

    closeModal('qrScannerModal');
    
    // Set Scholar Profile Card Data
    document.getElementById('scholarProfilePic').src = data.profile ? 'data:image/jpeg;base64,' + data.profile : 'placeholder.png';
    document.getElementById('scholarName').textContent = data.name;
    document.getElementById('scholarSemester').textContent = data.semesterName;

    // Set Info Rows Data
    const requestRow = document.getElementById('requestRow');
    const churchRow = document.getElementById('churchRow');

    document.getElementById('requestStatusText').textContent = `Request: ${data.requestStatus}`;
    requestRow.style.backgroundColor = data.requestStatus === 'Already Scanned' ? '#ffcccc' : '#d0d0d0'; // Reddish/Grey
    
    // 🚨 UPDATED SCHEDULE TEXT 🚨
    document.getElementById('scheduleText').textContent = `Schedule: ${data.schedule} (${data.scheduleType})`;
    // ----------------------------
    document.getElementById('departmentText').textContent = `Department: ${data.department}`;
    
    document.getElementById('churchText').textContent = `Church: ${data.churchName}`;
    churchRow.style.backgroundColor = data.churchBgColor === 'green' ? '#4CAF50' : '#f44336'; // Green/Red
    churchRow.style.color = 'white';

    // Populate Type of Fellowship Dropdown
    const selectElement = document.getElementById('typeOfFellowshipSelect');
    selectElement.innerHTML = '<option value="" disabled selected>Type of Fellowship</option>';
    data.typeOptions.forEach(opt => {
        const option = document.createElement('option');
        option.value = opt;
        option.textContent = opt;
        selectElement.appendChild(option);
    });

    // Open the Info Modal
    document.getElementById('scholarInfoModal').style.display = 'flex';
}

// Add this function to chPersonnelDash.js
async function recordAttendance() {
    if (!currentScholarData) {
        alert('Error: Scholar data not loaded.');
        closeModal('scholarInfoModal');
        return;
    }

    const selectElement = document.getElementById('typeOfFellowshipSelect');
    const typeOfAttendance = selectElement.value;

    if (!typeOfAttendance) {
        alert('Please select a Type of Fellowship.');
        return;
    }

    // Disable button to prevent double-click
    const recordBtn = document.querySelector('.record-btn');
    recordBtn.disabled = true;
    recordBtn.textContent = 'Recording...';

    try {
        const response = await fetch('/fellowship-record-attendance', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                scholar_id: currentScholarData.scholar_id,
                typeOfAttendance: typeOfAttendance,
                currentDate: currentScholarData.global.currentDate,
                currentSemId: currentScholarData.global.currentSemId,
                fellowshipId: currentScholarData.global.fellowshipId,
                scholarEmail: currentScholarData.global.scholarEmail,
                scholarFullName: currentScholarData.global.scholarFullName
            }),
        });

        const result = await response.json();

        if (response.ok) {
            closeModal('scholarInfoModal');
            showSuccessPopup(result.message);
        } else {
            alert('Recording failed: ' + result.message);
        }

    } catch (error) {
        console.error('Error recording attendance:', error);
        alert('A network error occurred while recording attendance.');
    } finally {
        recordBtn.disabled = false;
        recordBtn.textContent = 'RECORD';
    }
}
// ====================================================================
// === MANUAL SEARCH FUNCTIONS (UPDATED) ===
// ====================================================================

async function manualSearchScholar() {
    const surname = document.getElementById('manualSurname').value.trim();
    const firstname = document.getElementById('manualFirstname').value.trim();
    const statusElement = document.getElementById('manualSearchStatus');
    const resultsContainer = document.getElementById('manualSearchResults');

    if (!surname || !firstname) {
        statusElement.textContent = 'Please enter both the surname and firstname.';
        return;
    }

    statusElement.textContent = 'Searching...';
    resultsContainer.innerHTML = '';
    manualSearchModalResults = [];

    try {
        const response = await fetch('/fellowship-manual-search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ surname, firstname })
        });

        const result = await response.json();

        if (response.ok && result.data && result.data.length > 0) {
            manualSearchModalResults = result.data;
            
            // 🌟 NEW LOGIC: Check for exactly one result 🌟
            if (result.data.length === 1) {
                const scholar = result.data[0];
                statusElement.textContent = `Scholar found: ${scholar.name}. Displaying details...`;
                
                // 1. Close the search modal
                closeModal('manualSearchModal');
                
                // 2. Display the scholar info modal immediately
                displayScholarInfoModal(scholar);
                
            } else {
                // If multiple scholars are found, display the selection list
                statusElement.textContent = `${result.data.length} scholars found. Select to proceed:`;

                result.data.forEach((scholar, index) => {
                    const row = document.createElement('div');
                    row.className = 'record-row';
                    row.innerHTML = `
                        <span class="record-col name-col">${scholar.name}</span>
                        <span class="record-col church-col">${scholar.churchName}</span>
                        <span class="record-col status-col">${scholar.requestStatus}</span>
                    `;
                    row.setAttribute('data-index', index);
                    row.addEventListener('click', () => selectManualScholar(index));
                    resultsContainer.appendChild(row);
                });
            }

        } else {
            // No results found
            statusElement.textContent = result.message || 'No scholar found with that name for the current semester.';
        }

    } catch (error) {
        console.error('Error during manual search:', error);
        statusElement.textContent = 'An error occurred during search.';
    }
}

function selectManualScholar(index) {
    const scholar = manualSearchModalResults[index];
    if (scholar) {
        // Highlight the selected row
        document.querySelectorAll('#manualSearchResults .record-row').forEach(row => {
            row.classList.remove('selected');
        });
        document.querySelector(`#manualSearchResults .record-row[data-index="${index}"]`).classList.add('selected');

        // Close search modal and display the info modal
        closeModal('manualSearchModal');
        // Use the existing function to display the scholar info modal
        displayScholarInfoModal(scholar);
    }
}


// ====================================================================
// === RECORDS FUNCTIONS ===
// ====================================================================

async function loadAttendanceRecords(date, name) {
    const listContainer = document.getElementById('recordsList');
    const statusElement = document.getElementById('recordsStatus');
    listContainer.querySelectorAll('.record-row:not(.header-row)').forEach(row => row.remove());
    statusElement.style.display = 'block';
    statusElement.textContent = 'Loading records...';

    if (!date) {
        statusElement.textContent = 'Please select a date.';
        return;
    }

    try {
        const response = await fetch('/fellowship-get-records', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ attendanceDate: date, scholarName: name })
        });

        const result = await response.json();

        if (response.ok && result.data && result.data.length > 0) {
            statusElement.style.display = 'none';
            
            result.data.forEach(record => {
                const row = document.createElement('div');
                row.className = 'record-row';
                
                // Use the status to set a visual cue
                let statusColor = '#4CAF50'; // Present (Green)
                if (record.status === 'Absent') {
                    statusColor = '#f44336'; // Absent (Red)
                } else if (record.status === 'Excuse') {
                    statusColor = '#ffc107'; // Excuse (Amber)
                }

                row.innerHTML = `
                    <span class="record-col name-col">${record.name}</span>
                    <span class="record-col church-col">${record.churchName}</span>
                    <span class="record-col status-col" style="color: ${statusColor}; font-weight: bold;">${record.status} (${record.typeOfAttendance})</span>
                `;
                listContainer.appendChild(row);
            });

        } else {
            statusElement.textContent = result.message || 'No attendance records found for this date.';
        }

    } catch (error) {
        console.error('Error loading attendance records:', error);
        statusElement.textContent = 'An error occurred while fetching records.';
    }
}
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

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('successPopup').style.display = 'none';
    fetchUserProfile();

    // --- Manual Search Logic ---
    const manualSearchBtn = document.getElementById('manualSearchBtn');
    manualSearchBtn.addEventListener('click', manualSearchScholar);

    // --- Records Logic ---
    const recordsBtn = document.getElementById('recordsBtn');
    recordsBtn.addEventListener('click', () => {
        // Set the default date to today and load records
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('recordsDatePicker').value = today;
        loadAttendanceRecords(today, '');
        openModal('recordsModal');
    });

    const recordsDatePicker = document.getElementById('recordsDatePicker');
    const recordsNameSearch = document.getElementById('recordsNameSearch');

    // Event listener for date change
    recordsDatePicker.addEventListener('change', () => {
        const date = recordsDatePicker.value;
        const name = recordsNameSearch.value;
        loadAttendanceRecords(date, name);
    });

    // Event listener for name search (with a debounce for performance)
    let searchTimeout;
    recordsNameSearch.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            const date = recordsDatePicker.value;
            const name = recordsNameSearch.value;
            loadAttendanceRecords(date, name);
        }, 300); // 300ms delay
    });

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
                showSuccessPopup(result);
                closeModal('profileModal');
                fetchUserProfile();
            } else {
                alert(result);
            }
        } else {
            alert('Please select a file.');
        }
    });

    
});

