// scholarDash.js
let allGratisRecords = []; // Global variable to store all fetched records
let currentSummaryData = {};

let allFellowshipRecords = [];
let currentFellowshipSummaryData = {};

function toggleMenu() {
    const dropdownMenu = document.getElementById("dropdown-menu");
    dropdownMenu.classList.toggle("show-menu");
}

function openModal(modalId) {
    document.getElementById(modalId).style.display = 'flex';
}

function closeModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
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


// --- NEW FUNCTIONS FOR SCHOLAR SETUP MODAL ---

async function checkAndShowSetupModal() {
    try {
        const response = await fetch('/check-scholar-setup');
        if (!response.ok) {
            console.error('Failed to check setup status.');
            return;
        }

        const data = await response.json();

        if (data.needsSetup) {
            await fetchAndPopulateSetupData(data);
            
            // Set scholar ID and current IDs for form submission/logic
            document.getElementById('scholarIdInput').value = data.scholarId;
            document.getElementById('currentDeptId').value = data.currentDeptId || '';
            document.getElementById('currentSchedId').value = data.currentSchedId || '';
            document.getElementById('currentChurchId').value = data.currentChurchId || '';

            // Update UI based on missing data
            document.getElementById('sched-required').style.display = data.missing.sched ? 'inline' : 'none';
            document.getElementById('schedule-section').style.border = data.missing.sched ? '2px solid #00BFFF' : 'none';
            document.getElementById('schedule-type-fieldset').disabled = !data.missing.sched;

            document.getElementById('dept-required').style.display = data.missing.dept ? 'inline' : 'none';
            document.getElementById('department-section').style.border = data.missing.dept ? '2px solid #00BFFF' : 'none';
            document.getElementById('dept_id').disabled = !data.missing.dept;

            document.getElementById('church-required').style.display = data.missing.church ? 'inline' : 'none';
            document.getElementById('church-section').style.border = data.missing.church ? '2px solid #00BFFF' : 'none';
            document.getElementById('church_id').disabled = !data.missing.church;

            openModal('setupModal');
        } else {
            // Setup is complete, do nothing or log
            console.log('Scholar setup is complete.');
        }

    } catch (error) {
        console.error('Error in checkAndShowSetupModal:', error);
    }
}


async function fetchAndPopulateSetupData(setupStatus) {
    try {
        const response = await fetch('/fetch-setup-data');
        if (!response.ok) {
            document.getElementById('setup-modal-content').innerHTML = '<h2>Error</h2><p>Failed to load setup data.</p>';
            return;
        }

        const data = await response.json();
        
        // --- Populate Schedules ---
        const wholeDaySelect = document.getElementById('sched_id_whole');
        const halfDaySelect1 = document.getElementById('sched_id_half');
        const halfDaySelect2 = document.getElementById('sched_id_2');
        
        [wholeDaySelect, halfDaySelect1, halfDaySelect2].forEach(select => {
            // Clear existing options, but keep the initial "Select..." option
            while (select && select.options.length > 1) { // Added null check for safety
                select.remove(1);
            }
        });

        // Whole Day Schedules
        if (data.wholeDaySchedules && wholeDaySelect) {
            data.wholeDaySchedules.forEach(sched => {
                const option = new Option(`${sched.sched} (${sched.status})`, sched.id);
                option.disabled = sched.status === 'Full';
                wholeDaySelect.add(option);
            });
        }

        // Half Day Schedules
        if (data.halfDaySchedules && halfDaySelect1 && halfDaySelect2) {
            data.halfDaySchedules.forEach(sched => {
                const option = new Option(`${sched.sched} (${sched.status})`, sched.id);
                option.disabled = sched.status === 'Full';
                halfDaySelect1.add(option.cloneNode(true)); // Clone for Day 1
                halfDaySelect2.add(option); // Use for Day 2
            });
        }
        
        // --- Populate Departments ---
        const deptSelect = document.getElementById('dept_id');
        // Clear existing options
        if (deptSelect) { // Added null check for safety
            while (deptSelect.options.length > 1) { deptSelect.remove(1); }
        }
        
        const deptMessage = document.getElementById('dept-message');
        if (deptMessage) deptMessage.textContent = ''; // Clear previous messages

        if (data.departments && deptSelect) {
            data.departments.forEach(dept => {
                const option = new Option(`${dept.deptname} (${dept.status}${dept.limit !== 'N/A' ? ` - ${dept.current_count}/${dept.limit}` : ''})`, dept.id);
                option.disabled = dept.status === 'Full';
                deptSelect.add(option);
            });
        }

        // Handle Housekeeping lock
        if (data.housekeepingLock && data.housekeepingLock.isLocked && setupStatus.missing.dept) {
            const hkDeptId = data.housekeepingLock.deptId;
            if (deptSelect) deptSelect.value = hkDeptId;
            if (deptSelect) deptSelect.disabled = true;
            if (deptMessage) {
                deptMessage.textContent = "You are currently locked to the Housekeeping Department for this semester (Last semester's renewal status).";
                deptMessage.style.color = '#1a237e'; // Primary color for info
            }
        }

        // Disable if already set
        if (!setupStatus.missing.dept) {
            if (deptSelect) deptSelect.disabled = true;
            if (deptSelect) deptSelect.value = setupStatus.currentDeptId;
            if (deptMessage) {
                deptMessage.textContent = "Your department is already set and cannot be changed.";
                deptMessage.style.color = '#00BFFF'; // Green for success/set
            }
        }


        // --- Populate Churches ---
        const churchSelect = document.getElementById('church_id');
        // Clear existing options
        if (churchSelect) {
            while (churchSelect.options.length > 1) { churchSelect.remove(1); }
        }

        if (data.churches && churchSelect) {
            data.churches.forEach(church => {
                churchSelect.add(new Option(church.chname, church.id));
            });
        }

        // Disable if already set
        const churchMessage = document.getElementById('church-message');
        if (!setupStatus.missing.church) {
            if (churchSelect) churchSelect.disabled = true;
            if (churchSelect) churchSelect.value = setupStatus.currentChurchId;
            if (churchMessage) {
                churchMessage.textContent = "Your church is already set and cannot be changed.";
                churchMessage.style.color = '#00BFFF';
            }
        } else {
            if (churchMessage) churchMessage.textContent = '';
        }

        // --- Add Event Listeners for Schedule Logic ---
        if (document.getElementById('wholeDayRadio')) document.getElementById('wholeDayRadio').addEventListener('change', updateScheduleInputs);
        if (document.getElementById('halfDayRadio')) document.getElementById('halfDayRadio').addEventListener('change', updateScheduleInputs);
        if (document.getElementById('sched_id_half')) document.getElementById('sched_id_half').addEventListener('change', enforceDifferentSchedules);
        if (document.getElementById('sched_id_2')) document.getElementById('sched_id_2').addEventListener('change', enforceDifferentSchedules);
        
        // Initial call to set state based on missing schedule or default to whole day
        if (setupStatus.missing.sched) {
            // Default to whole day selection
            if (document.getElementById('wholeDayRadio')) document.getElementById('wholeDayRadio').checked = true;
            if (document.getElementById('wholeDayRadio')) document.getElementById('wholeDayRadio').dispatchEvent(new Event('change'));
            const scheduleMessage = document.getElementById('schedule-message');
            if (scheduleMessage) {
                scheduleMessage.textContent = 'Please select a schedule.';
                scheduleMessage.style.color = '#00BFFF';
            }
        } else {
            // If not missing, disable schedule selection and show current schedule (or just disable as per requirement)
            const scheduleMessage = document.getElementById('schedule-message');
            if (scheduleMessage) {
                scheduleMessage.textContent = 'Your schedule is already set and cannot be changed.';
                scheduleMessage.style.color = '#00BFFF';
            }
            if (document.getElementById('schedule-type-fieldset')) document.getElementById('schedule-type-fieldset').disabled = true;
            if (document.getElementById('wholeDayOptions')) document.getElementById('wholeDayOptions').style.display = 'none';
            if (document.getElementById('halfDayOptions')) document.getElementById('halfDayOptions').style.display = 'none';
            if (document.getElementById('sched_id_whole')) document.getElementById('sched_id_whole').required = false;
            if (document.getElementById('sched_id_half')) document.getElementById('sched_id_half').required = false;
            if (document.getElementById('sched_id_2')) document.getElementById('sched_id_2').required = false;
        }
        
    } catch (error) {
        console.error('Error fetching setup data:', error);
    }
}

function updateScheduleInputs() {
    const wholeDayChecked = document.getElementById('wholeDayRadio').checked;
    const wholeDayDiv = document.getElementById('wholeDayOptions');
    const halfDayDiv = document.getElementById('halfDayOptions');
    const wholeDaySelect = document.getElementById('sched_id_whole');
    const halfDaySelect1 = document.getElementById('sched_id_half');
    const halfDaySelect2 = document.getElementById('sched_id_2');

    if (wholeDayChecked) {
        if (wholeDayDiv) wholeDayDiv.style.display = 'block';
        if (halfDayDiv) halfDayDiv.style.display = 'none';
        
        if (wholeDaySelect) {
            wholeDaySelect.required = true;
            wholeDaySelect.disabled = false;
        }
        if (halfDaySelect1) {
            halfDaySelect1.required = false;
            halfDaySelect1.disabled = true;
            halfDaySelect1.value = ''; // Reset half-day values
        }
        if (halfDaySelect2) {
            halfDaySelect2.required = false;
            halfDaySelect2.disabled = true;
            halfDaySelect2.value = '';
        }
    } else {
        if (wholeDayDiv) wholeDayDiv.style.display = 'none';
        if (halfDayDiv) halfDayDiv.style.display = 'block';

        if (wholeDaySelect) {
            wholeDaySelect.required = false;
            wholeDaySelect.disabled = true;
            wholeDaySelect.value = ''; // Reset whole-day value
        }
        if (halfDaySelect1) {
            halfDaySelect1.required = true;
            halfDaySelect1.disabled = false;
        }
        if (halfDaySelect2) {
            halfDaySelect2.required = true;
            halfDaySelect2.disabled = false;
        }
    }
}

function enforceDifferentSchedules() {
    const sched1 = document.getElementById('sched_id_half');
    const sched2Select = document.getElementById('sched_id_2');

    if (!sched1 || !sched2Select) return;
    
    const sched1Value = sched1.value;
    const sched2Value = sched2Select.value;
    
    if (sched1Value && sched2Value && sched1Value === sched2Value) {
        alert('Day 2 Schedule must be different from Day 1 Schedule.');
        sched2Select.value = ''; // Reset Day 2 selection
        sched2Select.focus();
    }
}


/**
 * Fetches scholar card data and populates the QR Card Modal.
 */
async function fetchAndDisplayQrCard() {
    try {
        const response = await fetch('/get-scholar-card-data');
        if (!response.ok) {
            throw new Error(`Failed to fetch card data: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        // --- Populate the Modal UI ---
        document.getElementById('cardName').textContent = data.name || 'N/A';
        document.getElementById('cardRole').textContent = data.role || 'N/A';
        document.getElementById('cardSemester').textContent = data.semester || 'N/A';
        document.getElementById('cardScheduleType').textContent = data.scheduleType || 'N/A';
        document.getElementById('cardSchedule').textContent = data.schedule || 'N/A';
        document.getElementById('cardDepartment').textContent = data.department || 'N/A';
        document.getElementById('cardChurch').textContent = data.church || 'N/A';

        // --- Handle QR Code Display ---
        const cardQrCode = document.getElementById('cardQrCode');
        const qrPlaceholder = document.getElementById('qrPlaceholder');
        if (data.qrcode && cardQrCode && qrPlaceholder) {
            cardQrCode.src = data.qrcode;
            cardQrCode.style.display = 'block';
            qrPlaceholder.style.display = 'none';
        } else if (cardQrCode && qrPlaceholder) {
            cardQrCode.style.display = 'none';
            qrPlaceholder.style.display = 'block';
        }

        // --- Handle Profile Picture Display ---
        const cardProfilePic = document.getElementById('cardProfilePic');
        const profileIconPlaceholder = document.getElementById('profileIconPlaceholder');
        if (data.profile && cardProfilePic && profileIconPlaceholder) {
            // Profile is a Base64 string from the server route
            cardProfilePic.src = `data:image/jpeg;base64,${data.profile}`;
            cardProfilePic.style.display = 'block';
            profileIconPlaceholder.style.display = 'none';
        } else if (cardProfilePic && profileIconPlaceholder) {
            // Use the icon placeholder
            cardProfilePic.style.display = 'none';
            profileIconPlaceholder.style.display = 'block';
        }

        openModal('qrCardModal');

    } catch (error) {
        console.error('Error in fetchAndDisplayQrCard:', error);
        alert('Could not load Scholar Card data. Please try again.');
    }
}

/**
 * Uses html2canvas to render the scholarCard div as an image and downloads it.
 */
function downloadScholarCard() {
    const cardElement = document.getElementById('scholarCard');
    const downloadBtn = document.getElementById('downloadCardBtn');
    const statusText = document.getElementById('downloadStatus'); 

    // 1. Disable button and show status
    if (downloadBtn) {
        downloadBtn.disabled = true;
        downloadBtn.textContent = 'Generating...';
    }
    if (statusText) statusText.style.display = 'block';

    if (!cardElement) {
        alert('Card element not found.');
        if (downloadBtn) {
            downloadBtn.disabled = false;
            downloadBtn.textContent = 'DOWNLOAD';
        }
        if (statusText) statusText.style.display = 'none';
        return;
    }
    
    // Check if html2canvas and saveAs are loaded (required for existing logic)
    if (typeof html2canvas === 'undefined' || typeof saveAs === 'undefined') {
        alert('Required libraries (html2canvas/FileSaver) are not loaded.');
        if (downloadBtn) {
            downloadBtn.disabled = false;
            downloadBtn.textContent = 'DOWNLOAD';
        }
        if (statusText) statusText.style.display = 'none';
        return;
    }


    html2canvas(cardElement, { 
        scale: 2, // Higher scale for better resolution
        logging: false,
        useCORS: true 
    }).then(canvas => {
        // Convert canvas to blob for download
        canvas.toBlob(function(blob) {
            // Use FileSaver.js to save the file
            const cardName = document.getElementById('cardName').textContent.replace(/\s/g, '_');
            saveAs(blob, `Scholar_ID_Card_${cardName}.jpeg`);
            
            // Re-enable button and hide status
            if (downloadBtn) {
                downloadBtn.disabled = false;
                downloadBtn.textContent = 'DOWNLOAD';
            }
            if (statusText) statusText.style.display = 'none'; 
            
            showSuccessPopup('Scholar ID Card successfully downloaded!');
            closeModal('qrCardModal');

        }, 'image/jpeg', 0.9); // Quality set to 0.9 for JPEG
    }).catch(error => {
        console.error('Error generating card image:', error);
        alert('Failed to generate image for download. ' + error.message);

        // Re-enable button and hide status on failure
        if (downloadBtn) {
            downloadBtn.disabled = false;
            downloadBtn.textContent = 'DOWNLOAD';
        }
        if (statusText) statusText.style.display = 'none';
    });
}


// ===============================================
// NEW CERTIFICATE FUNCTIONS
// ===============================================

// Function to handle fetching and processing the eligibility check
async function checkCertificateEligibility() {
    try {
        const response = await fetch('/check-certificate-eligibility');
        const result = await response.json();

        if (response.status === 403) {
            console.log("Certificate check skipped: User not logged in or role mismatch.");
            return;
        }

        if (result.qualified) {
            console.log("Certificate eligibility check successful. Scholar is qualified.");
            await displayCertificateModal(result.data);
            
            // Log the certificate receipt to the database/send email (only if qualified)
            await logCertificateReceipt(); 
        } else {
            console.log(`Certificate eligibility check failed. Reason: ${result.reason || 'Unknown failure.'}`);
            // If the scholar is not qualified, ensure the modal remains hidden.
            const modal = document.getElementById('Modal-Certificate');
            if (modal) modal.style.display = 'none';
        }
    } catch (error) {
        console.error("Error checking certificate eligibility:", error);
    }
}

// Function to log the certificate reception (DB update and email)
async function logCertificateReceipt() {
    try {
        const response = await fetch('/receive-certificate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            // The server-side will use the session to get the scholar ID
            body: JSON.stringify({}) 
        });
        const result = await response.json();

        if (result.logged) {
            console.log(`Certificate receipt logged successfully: ${result.message}`);
        } else {
            // Log but don't prevent the user from seeing/downloading the certificate
            console.error(`Failed to log certificate receipt: ${result.message}`);
        }
    } catch (error) {
        console.error("Error logging certificate receipt:", error);
    }
}


// Function to populate and display the modal
async function displayCertificateModal(data) {
    const modal = document.getElementById('Modal-Certificate');
    
    // Check if the modal exists before proceeding
    if (!modal) {
        console.error("Modal-Certificate element not found in the DOM.");
        return;
    }

    // Populate the certificate content
    document.getElementById('certificate-name-display').textContent = data.fullName;
    document.getElementById('certificate-day1').textContent = data.day1;
    document.getElementById('certificate-day2').textContent = data.day2;
    document.getElementById('scholarHead-fullname-display').textContent = data.scholarHead_fullname;
    
    const signatureImg = document.getElementById('signature-image');
    if (data.signature_png && signatureImg) {
        // signature_png is a Base64 string from the server
        signatureImg.src = `data:image/png;base64,${data.signature_png}`;
        signatureImg.style.display = 'block';
    } else if (signatureImg) {
        signatureImg.style.display = 'none';
        console.warn("Signature image is missing or corrupted.");
    }

    // Display the modal
    modal.style.display = 'flex'; // Use flex to help with vertical centering
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';
}

// Function to close the modal
function closeCertificateModal() {
    const modal = document.getElementById('Modal-Certificate');
    if (modal) modal.style.display = 'none';
}


// Function to handle the download of the certificate as a JPEG
function downloadCertificate() {
    const certificateArea = document.getElementById('certificate-area');
    
    if (typeof html2canvas === 'undefined' || typeof saveAs === 'undefined') {
        alert('Required libraries (html2canvas/FileSaver) are not loaded in the HTML.');
        return;
    }

    if (!certificateArea) {
        console.error("Certificate area element not found.");
        return;
    }

    // Capture the certificate content
    html2canvas(certificateArea, {
        scale: 3, // Higher scale for better resolution
        useCORS: true, 
        allowTaint: true 
    }).then(canvas => {
        // Convert canvas to JPEG blob
        canvas.toBlob(function(blob) {
            // Use FileSaver.js to save the file
            const nameDisplay = document.getElementById('certificate-name-display');
            const name = nameDisplay ? nameDisplay.textContent.replace(/\s/g, '_') : 'Scholar';
            const filename = `Certificate_Completion_${name}.jpeg`;
            saveAs(blob, filename);
            closeCertificateModal();
            showSuccessPopup("Certificate successfully downloaded!");
        }, 'image/jpeg', 0.95); 
    }).catch(err => {
        console.error("Error generating certificate image:", err);
        alert('Failed to download certificate. Ensure the modal is visible and try again.');
    });
}

// ===============================================
// NEW ABSENT REQUEST FUNCTIONS
// ===============================================

/**
 * Utility function to format date as a readable string.
 * This version cleans the date string to ensure it's in YYYY-MM-DD format 
 * before adding T12:00:00 to prevent 'Invalid Date' errors.
 * @param {string} dateString - The date string from the database.
 * @returns {string} - Formatted date string (e.g., "October 31, 2025").
 */
const formatDate = (dateString) => {
    if (!dateString) return 'Invalid Date: Missing';
    
    // 1. Clean up the string: Take only the first 10 characters (YYYY-MM-DD)
    const cleanedDateString = dateString.substring(0, 10);

    // 2. Append 'T12:00:00' to force local timezone interpretation
    const date = new Date(cleanedDateString + 'T12:00:00'); 
    
    // Check if the date is valid before formatting
    if (isNaN(date.getTime())) {
        // This means even the cleaned string failed, which points to a data issue
        return `Invalid Date: ${cleanedDateString}`; 
    }

    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
};

/**
 * Fetches upcoming fellowship dates from the server and populates the dropdown.
 */
async function fetchUpcomingFellowships() {
    const dateSelect = document.getElementById('fellowshipDateSelect');
    const sendRequestBtn = document.getElementById('sendRequestBtn');

    if (!dateSelect || !sendRequestBtn) return; // Exit if elements aren't ready

    try {
        const response = await fetch('/api/upcoming-fellowships');
        if (!response.ok) {
            // Check for specific 404/403 response messages from the server for better debugging
            const errorData = await response.json().catch(() => ({ message: 'Failed to fetch fellowship dates.' }));
            throw new Error(errorData.message || 'Failed to fetch fellowship dates.');
        }
        const fellowships = await response.json();
        
        // Clear previous options
        dateSelect.innerHTML = '<option value="" disabled selected>Select Date</option>';

        if (fellowships.length === 0) {
            const noDatesOption = document.createElement('option');
            noDatesOption.value = '';
            noDatesOption.textContent = 'No upcoming fellowships available.';
            noDatesOption.disabled = true;
            dateSelect.appendChild(noDatesOption);
            sendRequestBtn.disabled = true;
            return;
        }

        // Populate the dropdown
        fellowships.forEach(f => {
            const option = document.createElement('option');
            option.value = f.id; // **Fellowship ID (fellowship_id) is the value (as requested)**
            // Display: Type - YYYY-MM-DD (using the corrected formatDate)
            option.textContent = `${f.type_fellowship} - ${formatDate(f.fellowship)}`;
            dateSelect.appendChild(option);
        });

        sendRequestBtn.disabled = false; // Enable button if dates are present

    } catch (error) {
        console.error('Error fetching upcoming fellowships:', error);
        alert(`Error loading upcoming fellowship dates: ${error.message}. Please try again.`);
        sendRequestBtn.disabled = true;
    }
}

/**
 * Handles the submission of the absent request form.
 */
async function handleAbsentRequestSubmit() {
    const dateSelect = document.getElementById('fellowshipDateSelect');
    const reasonInput = document.getElementById('reasonInput');
    const sendRequestBtn = document.getElementById('sendRequestBtn');

    if (!dateSelect || !reasonInput || !sendRequestBtn) return;

    const fellowship_id = dateSelect.value;
    const letter = reasonInput.value.trim();

    if (!fellowship_id) {
        alert('Please select a fellowship date.');
        return;
    }

    if (letter.length < 10) {
        alert('Please provide a detailed reason (at least 10 characters).');
        return;
    }

    sendRequestBtn.disabled = true;
    sendRequestBtn.textContent = 'Sending...';

    try {
        const response = await fetch('/api/absent-request', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ fellowship_id, letter })
        });

        const result = await response.json();

        if (response.ok) {
            showSuccessPopup(result.message);
            closeModal('absentRequestModal'); // Use your existing closeModal function
            
            // Clear form
            dateSelect.value = '';
            reasonInput.value = '';
            // Re-fetch dates to remove the one just submitted
            fetchUpcomingFellowships(); 
        } else {
            alert(`Request failed: ${result.message}`);
        }

    } catch (error) {
        console.error('Submission error:', error);
        alert('An unexpected error occurred while sending the request.');
    } finally {
        sendRequestBtn.disabled = false;
        sendRequestBtn.textContent = 'Send Request';
    }
}

/**
 * Fetches the scholar's gratis logs and summary data from the server.
 */
async function fetchGratisRecords() {
    const tableBody = document.getElementById('gratis-records-body');
    tableBody.innerHTML = '<tr><td colspan="8">Loading records...</td></tr>';
    
    try {
        const response = await fetch('/api/scholar/gratis-records');
        const data = await response.json();
        
        if (response.ok) {
            allGratisRecords = data.records;
            currentSummaryData = data.summary;
            displaySummary(data.summary);
            // Default display: filter by current date (or show all if no date filter is set yet)
            filterGratisRecords();
        } else {
            tableBody.innerHTML = `<tr><td colspan="8">${data.message || 'Failed to load records.'}</td></tr>`;
            console.error('API Error:', data.message);
        }
    } catch (error) {
        tableBody.innerHTML = '<tr><td colspan="8">An error occurred while connecting to the server.</td></tr>';
        console.error('Fetch Error:', error);
    }
}

/**
 * Displays the non-filterable summary data in the modal header.
 * @param {Object} summary - The summary object from the API response.
 */
function displaySummary(summary) {
    document.getElementById('summary-name').textContent = summary.name;
    document.getElementById('summary-semname').textContent = summary.semName;
    document.getElementById('summary-totaltime').textContent = summary.totalTime;
    document.getElementById('summary-nodates').textContent = summary.noOfDates;
    document.getElementById('summary-nolates').textContent = summary.noOfLates;
    document.getElementById('summary-noviolations').textContent = summary.noOfViolations;
}


/**
 * Filters and displays the records based on the selected date.
 * If no date is selected, it filters by the current date by default.
 */
function filterGratisRecords() {
    const dateFilterInput = document.getElementById('date-filter');
    const tableBody = document.getElementById('gratis-records-body');
    const filterDate = dateFilterInput.value;
    
    let recordsToDisplay = allGratisRecords;

    if (filterDate) {
        recordsToDisplay = allGratisRecords.filter(record => record.date === filterDate);
    } else {
        const today = new Date().toISOString().split('T')[0];
        // Try to filter by today's date first
        let todayRecords = allGratisRecords.filter(record => record.date === today);

        if (todayRecords.length > 0) {
            recordsToDisplay = todayRecords;
        } else {
            // If no records for today, show all
            recordsToDisplay = allGratisRecords;
            console.log("No records for today, showing all records by default.");
        }
    }

    renderTable(recordsToDisplay, tableBody);
}

/**
 * Renders the given records into the table body.
 * @param {Array} records - The array of records to display.
 * @param {HTMLElement} tableBody - The tbody element.
 */
function renderTable(records, tableBody) {
    tableBody.innerHTML = '';
    
    if (records.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="8">No gratis records found.</td></tr>';
        return;
    }

    records.forEach(record => {
        const row = tableBody.insertRow();
        row.insertCell().textContent = record.department;
        row.insertCell().textContent = record.date;
        row.insertCell().textContent = record.time_in ? record.time_in.substring(0, 5) : 'N/A';
        row.insertCell().textContent = record.time_out ? record.time_out.substring(0, 5) : 'N/A';
        row.insertCell().textContent = record.status;
        row.insertCell().textContent = record.totalduty;
        row.insertCell().textContent = record.statusMonitor;
        row.insertCell().textContent = record.violation;
    });
}

/**
 * Resets the date filter input and shows all records.
 */
function resetDateFilter() {
    document.getElementById('date-filter').value = '';
    // After resetting, explicitly filter to show all records, not just today's
    renderTable(allGratisRecords, document.getElementById('gratis-records-body'));
}


/**
 * Downloads the currently *displayed* records as a CSV file.
 */
function downloadGratisRecordsCsv() {
    const table = document.querySelector('#modal-gratis table');
    if (!table) return;

    let csv = [];
    const rows = table.querySelectorAll('tr');

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const cols = row.querySelectorAll('th, td');
        const rowData = [];

        for (let j = 0; j < cols.length; j++) {
            let data = cols[j].innerText.replace(/"/g, '""');
            rowData.push(`"${data}"`);
        }
        csv.push(rowData.join(','));
    }

    const summaryHeader = `Name,Semester,Total Time,No. of Dates,No. of Lates,No. of Violations\n`;
    const summaryData = `${currentSummaryData.name},${currentSummaryData.semName},"${currentSummaryData.totalTime}",${currentSummaryData.noOfDates},${currentSummaryData.noOfLates},${currentSummaryData.noOfViolations}\n\n`;
    
    const finalCsv = summaryHeader + summaryData + csv.join('\n');

    const blob = new Blob([finalCsv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    if (link.download !== undefined) { 
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", `Gratis_Records_${currentSummaryData.name.replace(/\s/g, '_')}_${new Date().toISOString().split('T')[0]}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
}

function downloadGratisRecordsJpeg() {
    const content = document.getElementById('gratis-content-for-image'); // The div containing summary and table
    const closeBtn = document.querySelector('#modal-gratis .close-btn');

    // Temporarily hide the close button for the screenshot
    if (closeBtn) {
        closeBtn.style.display = 'none';
    }

    html2canvas(content, {
        scale: 2, // Increase scale for higher resolution
        useCORS: true, // If you have external resources (fonts, images)
        logging: false // Disable logging
    }).then(canvas => {
        // Re-display the close button
        if (closeBtn) {
            closeBtn.style.display = 'block';
        }

        const link = document.createElement('a');
        link.download = `Gratis_Records_${currentSummaryData.name.replace(/\s/g, '_')}_${new Date().toISOString().split('T')[0]}.jpeg`;
        link.href = canvas.toDataURL('image/jpeg', 0.9); // 0.9 for quality
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }).catch(error => {
        console.error('Error generating JPEG:', error);
        alert('Failed to generate image. Please try again.');
        // Ensure close button is visible even if error occurs
        if (closeBtn) {
            closeBtn.style.display = 'block';
        }
    });
}

/**
 * Fetches the scholar's fellowship logs and summary data from the server.
 */
async function fetchFellowshipRecords() {
    const tableBody = document.getElementById('fellowship-records-body');
    tableBody.innerHTML = '<tr><td colspan="5">Loading records...</td></tr>';
    
    try {
        const response = await fetch('/api/scholar/fellowship-records');
        const data = await response.json();
        
        if (response.ok) {
            allFellowshipRecords = data.records;
            currentFellowshipSummaryData = data.summary;
            displayFellowshipSummary(data.summary);
            filterFellowshipRecords(); // Default display: current date or show all
        } else {
            tableBody.innerHTML = `<tr><td colspan="5">${data.message || 'Failed to load records.'}</td></tr>`;
            console.error('API Error:', data.message);
        }
    } catch (error) {
        tableBody.innerHTML = '<tr><td colspan="5">An error occurred while connecting to the server.</td></tr>';
        console.error('Fetch Error:', error);
    }
}

/**
 * Displays the non-filterable summary data in the modal header.
 */
function displayFellowshipSummary(summary) {
    document.getElementById('fellowship-summary-name').textContent = summary.name;
    document.getElementById('fellowship-summary-semname').textContent = summary.semName;
    document.getElementById('fellowship-summary-totalfellowship').textContent = summary.totalFellowship;
    document.getElementById('fellowship-summary-noabsent').textContent = summary.noOfAbsent;
    document.getElementById('fellowship-summary-excusedleft').textContent = summary.noOfExcusedLeft;
    document.getElementById('fellowship-summary-nosservice').textContent = summary.noOfSService;
}


/**
 * Filters and displays the records based on the selected date.
 */
function filterFellowshipRecords() {
    const dateFilterInput = document.getElementById('fellowship-date-filter');
    const tableBody = document.getElementById('fellowship-records-body');
    const filterDate = dateFilterInput.value;
    
    let recordsToDisplay = allFellowshipRecords;

    if (filterDate) {
        recordsToDisplay = allFellowshipRecords.filter(record => record.date === filterDate);
    } else {
        const today = new Date().toISOString().split('T')[0];
        let todayRecords = allFellowshipRecords.filter(record => record.date === today);

        if (todayRecords.length > 0) {
            recordsToDisplay = todayRecords;
        } else {
            recordsToDisplay = allFellowshipRecords;
            console.log("No fellowship records for today, showing all records by default.");
        }
    }

    renderFellowshipTable(recordsToDisplay, tableBody);
}

/**
 * Renders the given records into the table body.
 */
function renderFellowshipTable(records, tableBody) {
    tableBody.innerHTML = '';
    
    if (records.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="5">No fellowship records found.</td></tr>';
        return;
    }

    records.forEach(record => {
        const row = tableBody.insertRow();
        row.insertCell().textContent = record.church;
        row.insertCell().textContent = record.date;
        row.insertCell().textContent = record.status;
        row.insertCell().textContent = record.typeoffellowship;
        row.insertCell().textContent = record.no_of_sService;
    });
}

/**
 * Resets the date filter input and shows all records.
 */
function resetFellowshipDateFilter() {
    document.getElementById('fellowship-date-filter').value = '';
    renderFellowshipTable(allFellowshipRecords, document.getElementById('fellowship-records-body'));
}


/**
 * Downloads the currently *displayed* records as a CSV file.
 */
function downloadFellowshipRecordsCsv() {
    const table = document.querySelector('#modal-fellowship table');
    if (!table) return;

    let csv = [];
    const rows = table.querySelectorAll('tr');

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const cols = row.querySelectorAll('th, td');
        const rowData = [];

        for (let j = 0; j < cols.length; j++) {
            let data = cols[j].innerText.replace(/"/g, '""');
            rowData.push(`"${data}"`);
        }
        csv.push(rowData.join(','));
    }

    // Include the summary data at the top of the CSV
    const summaryHeader = `Name,Semester,Total Fellowship,No. of Absent,No. of Excused Left,No. of S-Service\n`;
    const summaryData = `${currentFellowshipSummaryData.name},${currentFellowshipSummaryData.semName},"${currentFellowshipSummaryData.totalFellowship}",${currentFellowshipSummaryData.noOfAbsent},${currentFellowshipSummaryData.noOfExcusedLeft},${currentFellowshipSummaryData.noOfSService}\n\n`;
    
    const finalCsv = summaryHeader + summaryData + csv.join('\n');

    const blob = new Blob([finalCsv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    if (link.download !== undefined) { 
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", `Fellowship_Records_${currentFellowshipSummaryData.name.replace(/\s/g, '_')}_${new Date().toISOString().split('T')[0]}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
}

/**
 * Downloads the content of the modal (excluding filters) as a JPEG image.
 */
function downloadFellowshipRecordsJpeg() {
    // Check if html2canvas is available (requires the CDN link in your HTML)
    if (typeof html2canvas === 'undefined') {
        alert("The 'html2canvas' library is required for JPEG download. Please ensure its CDN link is included in your scholarDash.html.");
        return;
    }

    const content = document.getElementById('fellowship-content-for-image'); 
    const closeBtn = document.querySelector('#modal-fellowship .close-btn');

    // Temporarily hide the close button for the screenshot
    if (closeBtn) {
        closeBtn.style.display = 'none';
    }

    html2canvas(content, {
        scale: 2, 
        useCORS: true, 
        logging: false 
    }).then(canvas => {
        // Re-display the close button
        if (closeBtn) {
            closeBtn.style.display = 'block';
        }

        const link = document.createElement('a');
        link.download = `Fellowship_Records_${currentFellowshipSummaryData.name.replace(/\s/g, '_')}_${new Date().toISOString().split('T')[0]}.jpeg`;
        link.href = canvas.toDataURL('image/jpeg', 0.9); 
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }).catch(error => {
        console.error('Error generating JPEG:', error);
        alert('Failed to generate image. Please try again.');
        if (closeBtn) {
            closeBtn.style.display = 'block';
        }
    });
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
// ===============================================
// DOMContentLoaded Event Listener (START)
// ===============================================

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('successPopup').style.display = 'none';
    fetchUserProfile();
    
    // 1. New: Call the certificate check function immediately
    checkCertificateEligibility(); 

    // Call the setup check function
    checkAndShowSetupModal();

    // --- CERTIFICATE LOGIC LISTENERS (NEW) ---
    const downloadCertBtn = document.getElementById('downloadCertificateBtn');
    if (downloadCertBtn) {
        downloadCertBtn.addEventListener('click', downloadCertificate);
    }

    // Close certificate modal on escape key
    document.addEventListener('keydown', (e) => {
        const certModal = document.getElementById('Modal-Certificate');
        if (e.key === "Escape" && certModal && certModal.style.display === 'flex') {
            closeCertificateModal();
        }
    });


    // --- QR CARD LOGIC ---
    const qrBtn = document.getElementById('qrBtn');
    if (qrBtn) {
        qrBtn.addEventListener('click', fetchAndDisplayQrCard);
    }
    const downloadCardBtn = document.getElementById('downloadCardBtn');
    if (downloadCardBtn) {
        downloadCardBtn.addEventListener('click', downloadScholarCard);
    }

    // --- ABSENT REQUEST MODAL LOGIC ---
    const absentReqBtn = document.getElementById('absentReqBtn');
    const absentRequestModal = document.getElementById('absentRequestModal');
    // We check for the modal and its close button to avoid errors if HTML hasn't loaded
    const absentCloseBtn = absentRequestModal ? absentRequestModal.querySelector('.close-btn') : null;
    const sendRequestBtn = document.getElementById('sendRequestBtn');

    if (absentReqBtn) {
        absentReqBtn.addEventListener('click', () => {
            // 1. Fetch dates first
            fetchUpcomingFellowships(); 
            // 2. Open the modal using existing function
            openModal('absentRequestModal'); 
        });
    }

    if (absentCloseBtn) {
        absentCloseBtn.addEventListener('click', () => {
            closeModal('absentRequestModal');
        });
    }

    if (sendRequestBtn) {
        sendRequestBtn.addEventListener('click', handleAbsentRequestSubmit);
    }
    
    // NOTE: The previous window.onclick handler has been consolidated into the window.addEventListener('click') block below.

    // --- 1. GRATIS MODAL SETUP ---
    const gratisBtn = document.getElementById('gratistBtn');
    const modalGratis = document.getElementById('modal-gratis');
    const downloadCsvBtnGratis = document.getElementById('download-gratis-csv-btn');
    const downloadJpegBtnGratis = document.getElementById('download-gratis-jpeg-btn');
    
    // NOTE: 'closeBtn' must be selected from 'modalGratis'
    const closeBtnGratis = modalGratis ? modalGratis.querySelector('.close-btn') : null;
    
    // Open Gratis Modal
    if (gratisBtn) {
        gratisBtn.addEventListener('click', () => {
            if (modalGratis) modalGratis.style.display = 'block'; // Use modalGratis
            fetchGratisRecords();
        });
    }

    // Close Gratis Modal (X button)
    if (closeBtnGratis) {
        closeBtnGratis.addEventListener('click', () => {
            modalGratis.style.display = 'none'; // Use modalGratis
        });
    }
    
    // Download Gratis Button Listeners (CSV and JPEG)
    if (downloadCsvBtnGratis) {
        downloadCsvBtnGratis.addEventListener('click', downloadGratisRecordsCsv);
    }
    if (downloadJpegBtnGratis) {
        downloadJpegBtnGratis.addEventListener('click', downloadGratisRecordsJpeg);
    }


    // --- 2. FELLOWSHIP MODAL SETUP ---
    const fellowshipBtn = document.getElementById('fellowshipBtn');
    const modalFellowship = document.getElementById('modal-fellowship'); 
    const downloadCsvBtnFellowship = document.getElementById('download-fellowship-csv-btn');
    const downloadJpegBtnFellowship = document.getElementById('download-fellowship-jpeg-btn');
    
    // NOTE: 'closeBtnFellowship' must be selected from 'modalFellowship'
    const closeBtnFellowship = modalFellowship ? modalFellowship.querySelector('.close-btn') : null;
    
    // Open Fellowship Modal
    if (fellowshipBtn) {
        fellowshipBtn.addEventListener('click', () => {
            if (modalFellowship) modalFellowship.style.display = 'block';
            fetchFellowshipRecords();
        });
    }

    // Close Fellowship Modal (X button)
    if (closeBtnFellowship) {
        closeBtnFellowship.addEventListener('click', () => {
            modalFellowship.style.display = 'none';
        });
    }

    // Download Fellowship Button Listeners (CSV and JPEG) - THIS IS THE FIX
    if (downloadCsvBtnFellowship) {
        downloadCsvBtnFellowship.addEventListener('click', downloadFellowshipRecordsCsv);
    }
    if (downloadJpegBtnFellowship) {
        downloadJpegBtnFellowship.addEventListener('click', downloadFellowshipRecordsJpeg);
    }

    // --- CONSOLIDATED WINDOW CLICK HANDLER FOR MODAL BACKDROPS ---
    // This handler will catch clicks on the dark backdrop of all modals (Gratis, Fellowship, Absent Request, and Certificate)
    window.addEventListener('click', (event) => {
        // Gratis Modal check
        if (modalGratis && event.target === modalGratis) { 
            modalGratis.style.display = 'none';
        }
        // Fellowship Modal check
        if (modalFellowship && event.target === modalFellowship) { 
            modalFellowship.style.display = 'none';
        }
        // Absent Request Modal check
        if (absentRequestModal && event.target === absentRequestModal) {
            closeModal('absentRequestModal');
        }
        // Certificate Modal check (NEW)
        const modalCert = document.getElementById('Modal-Certificate');
        if (modalCert && event.target === modalCert) { 
            closeCertificateModal();
        }
    });
    // --- END CONSOLIDATED HANDLER ---


    // Assuming these form IDs exist in your HTML and are required for existing functionality
    if (document.getElementById('uploadProfilePicForm')) {
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
    }


    
    // --- UPDATED EVENT LISTENER FOR SCHOLAR SETUP FORM ---
    if (document.getElementById('scholarSetupForm')) {
        document.getElementById('scholarSetupForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const form = e.target;
            const scholarId = document.getElementById('scholarIdInput').value;
            const currentDeptId = document.getElementById('currentDeptId').value;
            const currentSchedId = document.getElementById('currentSchedId').value;
            const currentChurchId = document.getElementById('currentChurchId').value;

            const dataToSend = {
                scholarId: scholarId,
            };
            
            let new_sched_id = null;
            let new_sched_id_2 = null;

            // Schedule Logic
            const wholeDayChecked = document.getElementById('wholeDayRadio') ? document.getElementById('wholeDayRadio').checked : false;
            const missingSched = document.getElementById('sched-required') ? document.getElementById('sched-required').style.display !== 'none' : false;

            if (missingSched) {
                if (wholeDayChecked) {
                    new_sched_id = document.getElementById('sched_id_whole') ? document.getElementById('sched_id_whole').value : null;
                } else {
                    new_sched_id = document.getElementById('sched_id_half') ? document.getElementById('sched_id_half').value : null;
                    new_sched_id_2 = document.getElementById('sched_id_2') ? document.getElementById('sched_id_2').value : null;
                }
                
                // Only add to dataToSend if a selection was made
                if (new_sched_id) dataToSend.new_sched_id = new_sched_id;
                
                // Explicitly set sched_id_2 based on type selection
                dataToSend.new_sched_id_2 = wholeDayChecked ? null : (new_sched_id_2 || null);
            }
            
            // Department Logic
            const missingDept = document.getElementById('dept-required') ? document.getElementById('dept-required').style.display !== 'none' : false;
            if (missingDept) {
                const deptId = document.getElementById('dept_id') ? document.getElementById('dept_id').value : null;
                if (deptId) dataToSend.new_dept_id = deptId;
            }

            // Church Logic
            const missingChurch = document.getElementById('church-required') ? document.getElementById('church-required').style.display !== 'none' : false;
            if (missingChurch) {
                const churchId = document.getElementById('church_id') ? document.getElementById('church_id').value : null;
                if (churchId) dataToSend.new_church_id = churchId;
            }

            // Check if there's actually something to send other than the scholarId
            if (Object.keys(dataToSend).length === 1 && dataToSend.scholarId) {
                closeModal('setupModal');
                showSuccessPopup('No new selections made, setup assumed complete or pending next login check.');
                return;
            }
            
            const submitBtn = document.getElementById('submitSetupBtn');
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.textContent = 'Saving...';
            }

            try {
                const response = await fetch('/update-scholar-setup', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(dataToSend),
                });
                
                const resultText = await response.text();
                let result;
                try {
                    result = JSON.parse(resultText);
                } catch (e) {
                    // Handle non-JSON response (e.g., error string)
                    result = { message: resultText }; 
                }
                
                if (response.ok) {
                    closeModal('setupModal');
                    
                    // ** QR CODE GENERATION LOGIC **
                    if (result.isNewSetup) {
                        showSuccessPopup('Setup successful. Generating QR Code...');

                        const qrResponse = await fetch('/generate-qrcode', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ scholarId: result.scholarId })
                        });

                        const qrResultText = await qrResponse.text();
                        let qrResult;
                        try {
                            qrResult = JSON.parse(qrResultText);
                        } catch (e) {
                            qrResult = { message: qrResultText };
                        }

                        if (qrResponse.ok) {
                            showSuccessPopup(`${result.message} ${qrResult.message}`);
                        } else {
                            console.error('QR Code Error:', qrResult.message);
                            alert(`QR Code Error: ${qrResult.message}`);
                            showSuccessPopup(`${result.message}. WARNING: Failed to generate QR Code.`);
                        }
                    } else {
                        showSuccessPopup(result.message);
                    }
                    
                    // Reload the page to re-run the check and fetch data on the dashboard
                    setTimeout(() => window.location.reload(), 3000); 
                } else {
                    alert(`Error: ${result.message}`);
                }
            } catch (error) {
                console.error('Setup submission error:', error);
                alert('An unexpected error occurred during submission.');
            } finally {
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Save Setup';
                }
            }
        });
    }
    
});

// --- NEW MODAL Elements for Exit Scholar ---
const exitSchoBtn = document.getElementById('exitSchoBtn');
const modalExit = document.getElementById('modal-exit');
const closeBtnExit = document.querySelector('.close-btn-exit');
const exitReasonInput = document.getElementById('exitReasonInput');
const sendExitRequestBtn = document.getElementById('sendExitRequestBtn');

// --- NEW Event Listeners for Exit Scholar ---
exitSchoBtn.addEventListener('click', () => {
    modalExit.style.display = 'block';
});

closeBtnExit.addEventListener('click', () => {
    modalExit.style.display = 'none';
    exitReasonInput.value = ''; // Clear input on close
});

// Close when clicking outside the modal
window.addEventListener('click', (event) => {
    if (event.target === modalExit) {
        modalExit.style.display = 'none';
        exitReasonInput.value = ''; // Clear input on close
    }
});

sendExitRequestBtn.addEventListener('click', handleExitRequest);

// --- NEW Function to handle Exit Request Submission ---
async function handleExitRequest() {
    const reason = exitReasonInput.value.trim();

    if (reason.length < 10) {
        alert("Please provide a more detailed reason for your exit request (at least 10 characters).");
        return;
    }

    if (!confirm("Are you sure you want to send this Exit Scholar request? This action cannot be easily undone.")) {
        return;
    }

    // Disable button to prevent double-submission
    sendExitRequestBtn.disabled = true;
    sendExitRequestBtn.textContent = 'Sending...';

    try {
        const response = await fetch('/api/scholar/submit-exit-request', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ letter: reason })
        });

        const result = await response.json();

        if (response.ok) {
            alert(result.message);
            modalExit.style.display = 'none';
            exitReasonInput.value = '';
        } else {
            alert(`Submission Failed: ${result.message}`);
        }
    } catch (error) {
        console.error('Error submitting exit request:', error);
        alert('An unexpected error occurred while submitting your request.');
    } finally {
        sendExitRequestBtn.disabled = false;
        sendExitRequestBtn.textContent = 'Send Request';
    }
}