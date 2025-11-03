/* monitoringDash.js
   Updated: integrated violation UI + monitoring flag logic + unchanged time-in/out behavior.
   NEW: Added fetchMonitoringLogs function and updated Records logic for MonitoringLogs.
*/

function toggleMenu() {
    const dropdownMenu = document.getElementById("dropdown-menu");
    dropdownMenu.classList.toggle("show-menu");
}

let mediaStream = null;
let scanner = null; // Declare scanner globally to manage its state

// Global variable to hold scholar data for the modal and record button
let currentScholarData = null;

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
// Manual search
async function manualSearchScholar() {
    const surname = document.getElementById('manualSurname').value.trim();
    const firstname = document.getElementById('manualFirstname').value.trim();
    const statusElement = document.getElementById('manualSearchStatus');

    if (!surname || !firstname) {
        statusElement.textContent = "Please enter both Surname and Firstname.";
        return;
    }

    statusElement.textContent = "Searching...";

    try {
        const response = await fetch('/monitoring-manual-search-scholar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ surname, firstname }),
        });

        const result = await response.json();

        if (response.ok) {
            closeModal('manualSearchModal');
            displayScholarInfoModal(result.data);
        } else {
            statusElement.textContent = `Search failed: ${result.message}`;
            alert('Search failed: ' + result.message);
        }

    } catch (error) {
        console.error('Error during manual search:', error);
        statusElement.textContent = 'A network error occurred while searching.';
        alert('A network error occurred.');
    }
}

// Send scanned QR data
async function sendScannedDataToServer(qrCodeContent) {
    try {
        const response = await fetch('/monitoring-scan-qr-code', {
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
// Display scholar info modal (populates new UI)
function displayScholarInfoModal(data) {
    currentScholarData = data;

    // Profile image
    const profilePicElement = document.getElementById('scholarProfilePic');
    if (data.profile) {
        profilePicElement.src = `data:image/png;base64,${data.profile}`;
    } else {
        profilePicElement.src = '/path/to/default/profile.png';
    }

    document.getElementById('scholarName').textContent = data.name || 'N/A';
    document.getElementById('scholarRole').textContent = data.role || 'Scholar';
    document.getElementById('scholarSemester').textContent = `${data.semname || ''} (${data.datestart || ''})`;
    document.getElementById('departmentName').textContent = data.deptname || 'N/A';
    document.getElementById('churchName').textContent = data.chname || 'N/A';
    document.getElementById('scheduleType').textContent = data.scheduleType || 'N/A';
    document.getElementById('scheduleDetails').textContent = data.scheduleDetails || 'N/A';
    
    // Hidden inputs: scholarId, log_id_to_update, latestGratisId (if any)
    document.getElementById('modalScholarId').value = data.scholar_id || '';
    document.getElementById('modalLogIdToUpdate').value = data.log_id_to_update || '';
    document.getElementById('modalLatestGratisId').value = data.latest_gratis_id || '';

    // Reset violation UI
    document.getElementById('noViolationRadio').checked = true;
    document.getElementById('withViolationRadio').checked = false;
    document.getElementById('violationReason').value = '';
    document.getElementById('violationReasonContainer').style.display = 'none';

    // When withViolationRadio toggles, show/hide reason
    document.getElementById('withViolationRadio').onchange = function () {
        document.getElementById('violationReasonContainer').style.display = this.checked ? 'block' : 'none';
    };
    document.getElementById('noViolationRadio').onchange = function () {
        document.getElementById('violationReasonContainer').style.display = this.checked ? 'none' : document.getElementById('violationReasonContainer').style.display;
    };

    // Close previous modals (scanner/manual) and open info modal
    closeModal('qrScannerModal');
    closeModal('manualSearchModal');
    openModal('scholarInfoModal');
}

// RECORD logic: sends scholarId, timeAction, violation boolean, and violation_reason
async function recordAttendance() {
    if (!currentScholarData) {
        alert("Error: Scholar data not found. Please scan again.");
        return;
    }

    const recordBtn = document.getElementById('recordAttendanceBtn');
    recordBtn.disabled = true;
    const prevText = recordBtn.textContent;
    recordBtn.textContent = 'Processing...';

    try {
        const scholarId = document.getElementById('modalScholarId').value;
        const timeAction = currentScholarData.requestAction || 'TIME IN';
        const withViolation = document.getElementById('withViolationRadio').checked;
        const violationReason = withViolation ? document.getElementById('violationReason').value.trim() : null;
        const latestGratisId = document.getElementById('modalLatestGratisId').value || null;

        // Determine the 'status' string based on the radio button
        const monitoringStatus = withViolation ? 'With Violation' : 'No Violation';

        const payload = {
            scholarId: scholarId,
            timeAction: timeAction,
            violation: withViolation,
            violation_reason: violationReason,
            latest_gratis_id: latestGratisId,
            monitoring_status: monitoringStatus
        };

        const response = await fetch('/monitoring-record-attendance', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const result = await response.json();

        if (response.ok) {
            closeModal('scholarInfoModal');
            showSuccessPopup(result.message || 'Record saved.');
        } else {
            alert('Record failed: ' + result.message);
        }

    } catch (error) {
        console.error('Error recording attendance:', error);
        alert('A network error occurred while recording attendance.');
    } finally {
        recordBtn.disabled = false;
        recordBtn.textContent = prevText || 'RECORD';
        currentScholarData = null;
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

function closePopup() {
    const successPopup = document.getElementById('successPopup');
    successPopup.style.display = 'none';
}

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
                // Assuming profileData.profile is a Base64 string directly from the server or properly structured data
                // NOTE: If the server is sending the profile image as a base64 string, use this:
                const base64String = Array.isArray(profileData.profile.data) ? 
                                     btoa(String.fromCharCode.apply(null, new Uint8Array(profileData.profile.data))) : 
                                     profileData.profile; // Assume it's a direct base64 string otherwise.
                
                profilePicElement.src = `data:image/jpeg;base64,${base64String}`;
                modalProfilePicElement.src = `data:image/jpeg;base64,${base64String}`;
                
                // --- Original (less reliable/more complex) BLOB logic removed for brevity/simplicity ---
            }
        } else {
            console.error('Failed to fetch user profile:', response.statusText);
        }
    } catch (error) {
        console.error('Error fetching profile:', error);
    }
}

// --- NEW FUNCTION: Fetch and display MonitoringLogs ---
async function fetchMonitoringLogs() {
    const recordsTableBody = document.getElementById('recordsTableBody');
    const recordsStatus = document.getElementById('recordsStatus');

    const selectedDate = document.getElementById('recordDate').value;
    const searchName = document.getElementById('recordSearchName').value.trim();

    recordsTableBody.innerHTML = '';
    recordsStatus.textContent = `Fetching monitoring logs for ${selectedDate}...`;

    try {
        const response = await fetch('/fetch-monitoring-logs', { // <-- New Endpoint
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                date: selectedDate,
                searchName: searchName,
            }),
        });

        const result = await response.json();

        if (response.ok) {
            const records = result.data;
            if (records.length === 0) {
                recordsStatus.textContent = `No monitoring logs found for the selected criteria on ${selectedDate}.`;
                return;
            }

            // NOTE: The HTML table header should ideally be updated to:
            // <th>Name</th> <th>Department</th> <th>Date</th> <th>Status</th> <th>Violation Reason</th>
            // The code below assumes you left the original headers (Name, Department, Time In, Time Out, Status)
            // and adjusts the cells accordingly:

            records.forEach(record => {
                const row = recordsTableBody.insertRow();
                
                // Column 1: Name
                row.insertCell().textContent = `${record.firstname} ${record.surname}`;
                
                // Column 2: Department
                row.insertCell().textContent = record.deptname || 'N/A';
                
                // Column 3 & 4 (Original Time In/Out, now used for Date and Status):
                // We'll use the 'Time In' column for the full Monitoring Date for best fit
                row.insertCell().textContent = record.monitoring_date; 
                row.insertCell().textContent = '-'; // Placeholder for Time Out
                
                // Column 5: Status (and Violation Reason if present)
                const statusCell = row.insertCell();
                statusCell.textContent = record.status || 'N/A';
                
                if (record.status === 'With Violation') {
                    statusCell.classList.add('violation-status');
                    statusCell.style.color = 'red'; // Basic styling for visibility
                    statusCell.textContent += record.violation_reason ? ` (Reason: ${record.violation_reason.substring(0, 30)}...)` : '';
                    statusCell.title = record.violation_reason; // Full reason on hover
                } else {
                    statusCell.classList.add('no-violation-status');
                    statusCell.style.color = 'green';
                }
            });

            recordsStatus.textContent = `Displaying ${records.length} monitoring logs for ${selectedDate}.`;

        } else {
            recordsStatus.textContent = `Error: ${result.message}`;
        }
    } catch (error) {
        console.error('Error fetching monitoring logs:', error);
        recordsStatus.textContent = 'A network error occurred while fetching monitoring logs.';
    }
}

function openRecordsModal() {
    const today = new Date().toISOString().split('T')[0];
    const recordDateInput = document.getElementById('recordDate');
    recordDateInput.value = today;
    
    // Clear the search name input
    document.getElementById('recordSearchName').value = ''; 

    openModal('recordsModal');
    fetchMonitoringLogs(); // <--- CALLS THE NEW FUNCTION
}

// NOTE: The original fetchAndDisplayRecords function (for GratisLogs) is now removed 
// as it was replaced by fetchMonitoringLogs as per the request requirements.


document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('successPopup').style.display = 'none';
    fetchUserProfile();

    const manualSearchBtn = document.getElementById('manualSearchBtn');
    if (manualSearchBtn) manualSearchBtn.addEventListener('click', manualSearchScholar);

    const recordsBtn = document.getElementById('recordsBtn');
    if (recordsBtn) recordsBtn.addEventListener('click', openRecordsModal); // Calls the initializer

    const searchRecordsBtn = document.getElementById('searchRecordsBtn');
    // Event listener updated to call the new fetching function
    if (searchRecordsBtn) searchRecordsBtn.addEventListener('click', fetchMonitoringLogs); 

    // Event listener updated to call the new fetching function
    document.getElementById('recordDate').addEventListener('change', fetchMonitoringLogs); 

    // --- Profile Picture Upload ---
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