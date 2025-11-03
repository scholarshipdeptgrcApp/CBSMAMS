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

    if (modalId === 'qrScannerModal') {
        const video = document.getElementById('qr-video');
        const status = document.getElementById('scanner-status');

        status.textContent = 'Initializing scanner...';
        
        // Reset video source object if it's lingering
        video.srcObject = null;
        
        // Instantiate Instascan
        scanner = new Instascan.Scanner({ 
            video: video, 
            scanPeriod: 5 // Scan every 5 milliseconds
        });
        
        // 1. Set up the Listener for a successful scan
        scanner.addListener('scan', function (content) {
            console.log("QR Code Scanned:", content);
            // Prevent re-scans immediately after success
            scanner.stop(); 
            
            status.textContent = 'QR Code detected. Sending data...';
            
            // Send the content to the server for processing and logging
            sendScannedDataToServer(content);
        });

        try {
            // 2. Get the cameras and start the scan
            const cameras = await Instascan.Camera.getCameras();
            
            if (cameras.length > 0) {
                // Prioritize the back camera (index 1) if available, otherwise use the first one
                const backCamera = cameras.find(c => c.name.toLowerCase().includes('back') || c.name.toLowerCase().includes('environment'));
                const cameraToUse = backCamera || cameras[0];
                
                await scanner.start(cameraToUse);
                status.textContent = 'Camera ready. Center a QR code to scan.';
                
                // Save the media stream for cleanup (though Instascan handles most of it)
                if(video.srcObject) {
                    mediaStream = video.srcObject;
                }

            } else {
                status.textContent = 'No cameras found on this device.';
                console.error('No cameras found.');
            }

        } catch (err) {
            console.error("Error accessing camera with Instascan: ", err);
            status.textContent = 'Camera error: ' + (err.name || 'Unknown Error');
        }
    }
    // No specific initialization needed for 'manualSearchModal' or 'scholarInfoModal' on open
}

function closeModal(modalId) {
    document.getElementById(modalId).style.display = 'none';

    if (modalId === 'qrScannerModal') {
        // Stop the scanner and cleanup
        if (scanner) {
            scanner.stop().catch(e => console.error("Error stopping scanner:", e));
            scanner = null; // Clear scanner instance
        }

        // Also stop the raw media stream as a fallback
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
// --- NEW FUNCTION: Handle Manual Scholar Search and Display Info ---
async function manualSearchScholar() {
    const surname = document.getElementById('manualSurname').value.trim();
    const firstname = document.getElementById('manualFirstname').value.trim();
    const statusElement = document.getElementById('manualSearchStatus');

    if (!surname || !firstname) {
        statusElement.textContent = "Please enter both Surname and Firstname.";
        return;
    }

    // Clear previous status and show processing state
    statusElement.textContent = "Searching...";
    
    try {
        const response = await fetch('/manual-search-scholar', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ surname, firstname }),
        });
        
        const result = await response.json();

        if (response.ok) {
            // Success: Close the search modal and use the existing function to display the info modal
            closeModal('manualSearchModal');
            // displayScholarInfoModal is the key to unified flow
            displayScholarInfoModal(result.data); 
        } else {
            // Failure: Show error in the status element
            statusElement.textContent = `Search failed: ${result.message}`;
            alert('Search failed: ' + result.message);
        }

    } catch (error) {
        console.error('Error during manual search:', error);
        statusElement.textContent = 'A network error occurred while searching.';
        alert('A network error occurred.');
    }
}


// --- MODIFIED sendScannedDataToServer FUNCTION (Remains the same as your last version) ---
async function sendScannedDataToServer(qrCodeContent) {
    try {
        const response = await fetch('/scan-qr-code', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ qrData: qrCodeContent }),
        });
        
        const result = await response.json();

        // Update status for user feedback
        document.getElementById('scanner-status').textContent = result.message;

        if (response.ok) {
            // New logic: Pass the full data object to the display function
            displayScholarInfoModal(result.data); 
        } else {
            // Close scanner modal and show the error in an alert
            closeModal('qrScannerModal');
            alert('Scan failed: ' + result.message);
        }
        
        // Removed the scanner re-enable logic from here, as the scanner modal is closed now.
        // If the user closes the info modal and re-opens the scanner, the camera will restart in openModal.

    } catch (error) {
        console.error('Error sending scanned data to server:', error);
        document.getElementById('scanner-status').textContent = 'Communication Error: Check server connection.';
        closeModal('qrScannerModal');
        alert('A network error occurred.');
    }
}


// --- NEW FUNCTION TO DISPLAY SCHOLAR INFO MODAL (Remains the same) ---
function displayScholarInfoModal(data) {
    currentScholarData = data; // Store the data globally
    
    // Set Profile Image (Placeholder for now, assuming data.profilePic exists)
    const profilePicElement = document.getElementById('scholarProfilePic');
    if (data.profile) {
        // Assuming data.profile is a data URI or a URL
        profilePicElement.src = `data:image/png;base64,${data.profile}`; 
    } else {
        // Use a default image if no profile picture is available
        profilePicElement.src = '/path/to/default/profile.png';
    }

    // Set Scholar Details
    document.getElementById('scholarName').textContent = data.name;
    document.getElementById('scholarRole').textContent = data.role; // Assuming role comes from server
    document.getElementById('scholarSemester').textContent = `${data.semname} (${data.datestart})`;
    document.getElementById('departmentName').textContent = data.deptname;
    document.getElementById('churchName').textContent = data.chname;

    // Set Schedule Details and Background
    document.getElementById('scheduleType').textContent = data.scheduleType; // HALF DAY or WHOLE DAY
    document.getElementById('scheduleDetails').textContent = data.scheduleDetails; // 8:00 AM - 12:00 PM(THU) etc.

    const scheduleBlock = document.getElementById('scheduleBlock');
    scheduleBlock.classList.remove('schedule-match', 'schedule-no-match');
    if (data.scheduleMatch) {
        scheduleBlock.classList.add('schedule-match');
    } else {
        scheduleBlock.classList.add('schedule-no-match');
    }

    // Set Request/Time Status
    document.getElementById('requestAction').textContent = data.requestAction; // TIME IN or TIME OUT

    // Display the new modal and close the previous modal (scanner or manual search)
    closeModal('qrScannerModal'); // This safely does nothing if it wasn't open
    closeModal('manualSearchModal'); // This safely does nothing if it wasn't open
    openModal('scholarInfoModal');
}

// --- NEW FUNCTION TO HANDLE RECORD BUTTON CLICK (Remains the same) ---
async function recordAttendance() {
    if (!currentScholarData) {
        alert("Error: Scholar data not found. Please scan again.");
        return;
    }

    // Disable the button to prevent double-click
    const recordBtn = document.getElementById('recordAttendanceBtn');
    recordBtn.disabled = true;
    recordBtn.textContent = 'Processing...';

    try {
        const response = await fetch('/record-attendance', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            // Send essential data back to the server for final logging
            body: JSON.stringify({ 
                scholarId: currentScholarData.scholar_id,
                timeAction: currentScholarData.requestAction // 'TIME IN' or 'TIME OUT'
            }),
        });
        
        const result = await response.json();

        if (response.ok) {
            closeModal('scholarInfoModal');
            showSuccessPopup(`Attendance recorded: ${result.message}`);
        } else {
            alert('Record failed: ' + result.message);
        }

    } catch (error) {
        console.error('Error recording attendance:', error);
        alert('A network error occurred while recording attendance.');
    } finally {
        // Re-enable and reset the button regardless of success/fail
        recordBtn.disabled = false;
        recordBtn.textContent = 'RECORD';
        currentScholarData = null; // Clear data after submission attempt
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
// --- NEW FUNCTION: Fetch and Display Records (Revised column logic) ---
async function fetchAndDisplayRecords() {
    const recordsTableBody = document.getElementById('recordsTableBody');
    const recordsStatus = document.getElementById('recordsStatus');

    const selectedDate = document.getElementById('recordDate').value; 
    const searchName = document.getElementById('recordSearchName').value.trim();
    
    recordsTableBody.innerHTML = ''; 
    recordsStatus.textContent = `Fetching records for ${selectedDate}...`;

    try {
        const response = await fetch('/fetch-attendance-records', {
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
                recordsStatus.textContent = `No records found for the selected criteria on ${selectedDate}.`;
                return;
            }

            // Populate the table
            records.forEach(record => {
                const row = recordsTableBody.insertRow();

                // 1. Name
                row.insertCell().textContent = `${record.firstname} ${record.surname}`;

                // 2. Department
                row.insertCell().textContent = record.deptname || 'N/A';

                // 3. Time In (Formatted)
                const timeIn = record.time_in ? new Date(`2000/01/01 ${record.time_in}`).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }) : '-';
                row.insertCell().textContent = timeIn;

                // 4. Time Out (Formatted)
                const timeOut = record.time_out ? new Date(`2000/01/01 ${record.time_out}`).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }) : '-';
                row.insertCell().textContent = timeOut;


                // 5. Status
                row.insertCell().textContent = record.status || 'Pending';
            });

            recordsStatus.textContent = `Displaying ${records.length} records for ${selectedDate}.`;

        } else {
            recordsStatus.textContent = `Error: ${result.message}`;
        }
    } catch (error) {
        console.error('Error fetching records:', error);
        recordsStatus.textContent = 'A network error occurred while fetching records.';
    }
}


// --- NEW FUNCTION: Set current date and open Records Modal ---
function openRecordsModal() {
    const today = new Date().toISOString().split('T')[0]; // Format YYYY-MM-DD
    const recordDateInput = document.getElementById('recordDate');
    
    // Set current date as default
    recordDateInput.value = today;
    
    // Open the modal
    openModal('recordsModal'); 

    // Load records for the default date immediately
    fetchAndDisplayRecords();
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
    
    // NEW: Manual Search Button Event Listener
    const manualSearchBtn = document.getElementById('manualSearchBtn');
    if (manualSearchBtn) {
        manualSearchBtn.addEventListener('click', manualSearchScholar);
    }

    // NEW: Records Button Event Listener
    const recordsBtn = document.getElementById('recordsBtn');
    if (recordsBtn) {
        recordsBtn.addEventListener('click', openRecordsModal); 
    }

    // REVISED: Search Button Event Listener (ID changed to searchRecordsBtn)
    const searchRecordsBtn = document.getElementById('searchRecordsBtn');
    if (searchRecordsBtn) {
        searchRecordsBtn.addEventListener('click', fetchAndDisplayRecords);
    }

    // Auto-refresh when the Date input changes
    document.getElementById('recordDate').addEventListener('change', fetchAndDisplayRecords);
    

    // Upload Profile Picture
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

