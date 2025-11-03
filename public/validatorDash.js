let currentRequestId = null;
let currentRequestType = null;
let pollingInterval = null;


const badWords = ['gago', 'putangina', 'tangina', 'puta'];

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

async function fetchAvailableSlot() {
    const avblSlotElement = document.getElementById('avbl-slot');
    const acceptButton = document.getElementById('acceptBtn');
    try {
        const response = await fetch('/avbl-slot');
        const data = await response.json();

        if (response.ok && data.success) {
            const { avbl_slot, raw_avl_slot, limit_count } = data;

            // Show available slot
            const avblSlotNumberElement = document.getElementById('avbl-slot-number');
            if (avblSlotNumberElement) {
                avblSlotNumberElement.textContent = avbl_slot;
            } else {
                avblSlotElement.textContent = `Available Slot: ${avbl_slot}`;
            }

            // Disable "Accept" button if slots are full
            if (raw_avl_slot >= limit_count) {
                if (acceptButton) {
                    acceptButton.disabled = true;
                    acceptButton.title = 'All slots are filled';
                }
            } else {
                if (acceptButton) {
                    acceptButton.disabled = false;
                    acceptButton.title = '';
                }
            }

        } else {
            console.error('Failed to fetch available slots:', data.message);
            avblSlotElement.textContent = `Available Slot: N/A`;
        }
    } catch (error) {
        console.error('Error fetching available slots:', error);
        avblSlotElement.textContent = `Available Slot: N/A`;
    }
}


async function fetchAndDisplayRequest() {
    const requestCardContainer = document.getElementById('request-card-container');
    const noRequestsMessage = document.getElementById('no-requests-message');
    const remainingCountElement = document.getElementById('remaining-count');
    const requestNumberElement = document.getElementById('request-number');
    const validateBtn = document.getElementById('validate-btn');
    const requestTypeElement = document.getElementById('request-type-label');

    try {
        const response = await fetch('/api/assign-next-request');
        const data = await response.json();

        if (response.ok && data.id) {
            
            currentRequestId = data.id;
            currentRequestType = data.type;
            requestCardContainer.classList.remove('hidden');
            noRequestsMessage.classList.add('hidden');
            validateBtn.style.display = 'block';

            requestNumberElement.textContent = `REQUEST NO. ${data.applicantNumber}`;
            requestTypeElement.textContent = `Type: ${data.type.charAt(0).toUpperCase() + data.type.slice(1)}`;

        } else {
            
            currentRequestId = null;
            currentRequestType = null;
            requestCardContainer.classList.add('hidden');
            noRequestsMessage.classList.remove('hidden');
            validateBtn.style.display = 'none';
        }

        
        const countResponse = await fetch('/api/pending-count');
        const countData = await countResponse.json();
        remainingCountElement.textContent = `Remaining Requests: ${countData.count}`;

    } catch (error) {
        console.error('Error fetching request:', error);
        requestCardContainer.classList.add('hidden');
        noRequestsMessage.classList.remove('hidden');
        noRequestsMessage.querySelector('h2').textContent = 'An error occurred. Please refresh.';
    }
}


// handleValidateClick function
async function handleValidateClick() {
    if (!currentRequestId || !currentRequestType) {
        alert('No request is currently assigned. Please refresh.');
        return;
    }

    const detailsModal = document.getElementById('detailsModal');
    const detailsContent = document.getElementById('details-content');
    const acceptBtn = document.getElementById('acceptBtn');
    const rejectBtn = document.getElementById('rejectBtn');

    detailsContent.innerHTML = 'Loading request details...';
    acceptBtn.style.display = 'none';
    rejectBtn.style.display = 'none';

    openModal('detailsModal');

    try {
        const response = await fetch(`/api/request-details/${currentRequestId}/${currentRequestType}`);
        const data = await response.json();

        if (response.ok) {
            let documentsHtml = '';

            function guessMimeType(base64Data) {
                if (base64Data.startsWith('UEsDB')) {
                    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'; // DOCX
                } else if (base64Data.startsWith('JVBERi0')) {
                    return 'application/pdf'; // PDF
                } else if (base64Data.startsWith('/9j/')) {
                    return 'image/jpeg'; // JPG
                } else if (base64Data.startsWith('iVBORw0KG')) {
                    return 'image/png'; // PNG
                }
                return 'image/jpeg'; // Default fallback
            }

            function createFileHtml(title, base64Data) {
                if (base64Data && typeof base64Data === 'string' && base64Data.length > 0) {
                    const mimeType = guessMimeType(base64Data);

                    if (mimeType.startsWith('image/')) {
                        return `
                            <div class="document-item">
                                <h4>${title}</h4>
                                <img src="data:${mimeType};base64,${base64Data}" alt="${title}" onclick="zoomImage(this.src)" style="cursor: zoom-in;">
                            </div>
                        `;
                    } else {
                        return `
                            <div class="document-item">
                                <h4>${title}</h4>
                                <a href="data:${mimeType};base64,${base64Data}" 
                                download="${title}" 
                                class="btn btn-success download-button"
                                style="margin-top: 10px; display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; border-radius: 6px; font-weight: 600; text-decoration: none; color: white;">
                                <i class="bi bi-download"></i> Download ${title}
                                </a>
                            </div>
                        `;
                    }
                }

                return `
                    <div class="document-item">
                        <h4>${title}</h4>
                        <p>No document submitted.</p>
                    </div>
                `;
            }


            if (currentRequestType === 'application') {
                documentsHtml = `
                    <h4>Application Documents</h4>
                    <div class="document-section">
                        ${createFileHtml('Form One', data.formOne)}
                        ${createFileHtml('TOR', data.tor)}
                        ${createFileHtml('Admission Slip', data.admSlip)}
                        ${createFileHtml('Last Gradeslip', data.lGradeslip)}
                        ${createFileHtml('COR', data.cor)}
                    </div>
                    <h4>Common Documents</h4>
                    <div class="common-documents-section">
                        ${createFileHtml('Recommendation Letter 1', data.recLet1)}
                        ${createFileHtml('Valid ID 1', data.valid1)}
                        ${createFileHtml('Recommendation Letter 2', data.recLet2)}
                        ${createFileHtml('Valid ID 2', data.valid2)}
                        ${createFileHtml('Testimony', data.testimony)}
                        ${createFileHtml('House Photos', data.housePhotos)}
                        ${createFileHtml('Certificate of Indigence', data.certIndigence)}
                    </div>
                `;
            } else if (currentRequestType === 'renewal') {
                documentsHtml = `
                    <h4>Renewal Documents</h4>
                    <div class="document-section">
                        ${createFileHtml('Gradeslip', data.gradeslip)}
                        ${createFileHtml('COC', data.coc)}
                        ${createFileHtml('COR', data.cor)}
                    </div>
                `;
            }

            detailsContent.innerHTML = `
                <div class="request-info-section">
                    <h3>Request Information</h3>
                    <p><strong>Type:</strong> ${data.type}</p>
                    <p><strong>Applicant Type:</strong> ${data.applicant_type}</p>
                    <p><strong>Name:</strong> ${data.firstname} ${data.surname}</p>
                    <p><strong>Email:</strong> ${data.email}</p>
                    <p><strong>Year Level:</strong> ${data.yearLevel}</p>
                    <p><strong>Course:</strong> ${data.course}</p>
                </div>
                <div class="documents-container">
                    ${documentsHtml}
                </div>
            `;
            acceptBtn.style.display = 'inline-block';
            rejectBtn.style.display = 'inline-block';
        } else {
            detailsContent.innerHTML = `<p class="error-message">${data.message || 'Failed to load request details.'}</p>`;
        }
    } catch (error) {
        console.error('Error fetching request details:', error);
        detailsContent.innerHTML = `<p class="error-message">An error occurred while fetching details.</p>`;
    }
}

async function handleAcceptClick() {
    if (!currentRequestId || !currentRequestType) {
        alert('No request is currently assigned.');
        return;
    }

    if (confirm(`Are you sure you want to accept this ${currentRequestType}?`)) {
        try {
            const endpoint = `/api/accept-${currentRequestType}/${currentRequestId}`;
            const response = await fetch(endpoint, {
                method: 'POST'
            });
            const result = await response.json();

            if (response.ok) {
                showSuccessPopup(result.message);
                closeModal('detailsModal');
                fetchAndDisplayRequest();
            } else {
                alert(`Error: ${result.message}`);
            }
        } catch (error) {
            console.error(`Error accepting ${currentRequestType}:`, error);
            alert('An error occurred while processing the request.');
        }
    }
}

// A list of documents for each request type
const documentLists = {
    application: [
        { value: 'formOne', label: 'Form One' },
        { value: 'tor', label: 'TOR' },
        { value: 'admSlip', label: 'Admission Slip' },
        { value: 'lGradeslip', label: 'Last Gradeslip' },
        { value: 'cor', label: 'COR (Application)' },
        { value: 'recLet1', label: 'Recommendation Letter 1' },
        { value: 'valid1', label: 'Valid ID 1' },
        { value: 'recLet2', label: 'Recommendation Letter 2' },
        { value: 'valid2', label: 'Valid ID 2' },
        { value: 'testimony', label: 'Testimony' },
        { value: 'housePhotos', label: 'House Photos' },
        { value: 'certIndigence', label: 'Certificate of Indigence' }
    ],
    renewal: [
        { value: 'gradeslip', label: 'Gradeslip' },
        { value: 'coc', label: 'Certificate of Completion (COC)' },
        { value: 'cor', label: 'COR (Renewal)' }
    ]
};

function handleRejectClick() {
    closeModal('detailsModal');
    
    // Get the container where the checkboxes will be placed
    const rejectDocsContainer = document.getElementById('reject-docs-container');
    rejectDocsContainer.innerHTML = ''; // Clear previous content

    // Get the correct list of documents based on the current request type
    const docs = documentLists[currentRequestType];

    if (docs) {
        // Iterate over the list and create a checkbox for each document
        docs.forEach(doc => {
            // **KEY JS FIX 1: Create a wrapper element (div) for each checkbox item**
            const itemWrapper = document.createElement('div');
            itemWrapper.classList.add('checkbox-item'); // Apply the new CSS class

            const label = document.createElement('label');
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.name = 'rejectedDocs';
            checkbox.value = doc.value;
            
            // Append the checkbox and text to the label
            label.appendChild(checkbox);
            label.appendChild(document.createTextNode(doc.label));
            
            // **KEY JS FIX 2: Append the label (which contains the checkbox) to the wrapper**
            itemWrapper.appendChild(label);
            
            // **KEY JS FIX 3: Append the wrapper to the main container**
            rejectDocsContainer.appendChild(itemWrapper);
        });
    }

    openModal('rejectModal');
}


async function handleRejectFormSubmit(e) {
    e.preventDefault();

    if (!currentRequestId || !currentRequestType) {
        alert('No request is currently assigned.');
        return;
    }

    const rejectionCategory = document.getElementById('rejectionCategory').value;
    const remarks = document.getElementById('rejectRemarks').value.trim();
    const rejectedDocs = [];

    document.querySelectorAll('#rejectForm input[type="checkbox"]:checked').forEach(checkbox => {
        rejectedDocs.push(checkbox.value);
    });

    if (rejectionCategory === 'invalid_documents' && rejectedDocs.length === 0) {
        alert('Please select at least one invalid document.');
        return;
    }

    if (remarks === '') {
        alert('Please provide a reason in the remarks section.');
        return;
    }

    for (const word of badWords) {
        if (remarks.toLowerCase().includes(word)) {
            alert('Remarks contain inappropriate language. Please be professional.');
            return;
        }
    }

    if (confirm(`Are you sure you want to reject this ${currentRequestType}?`)) {
        try {
            const endpoint = `/api/reject-${currentRequestType}/${currentRequestId}`;
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    rejectedDocs,
                    rejectionCategory,
                    remarks
                })
            });

            const result = await response.json();

            if (response.ok) {
                showSuccessPopup(result.message);
                closeModal('rejectModal');
                fetchAndDisplayRequest();
            } else {
                alert(`Error: ${result.message}`);
            }
        } catch (error) {
            console.error(`Error rejecting ${currentRequestType}:`, error);
            alert('An error occurred while processing the request.');
        }
    }
}

function zoomImage(src) {
    const modal = document.createElement('div');
    modal.style.position = 'fixed';
    modal.style.top = '0';
    modal.style.left = '0';
    modal.style.width = '100%';
    modal.style.height = '100%';
    modal.style.backgroundColor = 'rgba(0,0,0,0.8)';
    modal.style.display = 'flex';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';
    modal.style.zIndex = '9999';
    modal.innerHTML = `
        <img src="${src}" style="max-width:90%; max-height:90%; box-shadow: 0 0 20px #fff;">
    `;
    modal.onclick = () => document.body.removeChild(modal);
    document.body.appendChild(modal);
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

async function pollForNextRequest() {
    fetchAndDisplayRequest();
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('successPopup').style.display = 'none';
    fetchUserProfile();
    fetchAndDisplayRequest();
    fetchAvailableSlot();

    pollingInterval = setInterval(() => {
        pollForNextRequest();
        fetchAvailableSlot();
    }, 5000);
    
    document.getElementById('validate-btn').addEventListener('click', handleValidateClick);
    document.getElementById('acceptBtn').addEventListener('click', handleAcceptClick);
    document.getElementById('rejectBtn').addEventListener('click', handleRejectClick);

    document.getElementById('closeRejectModalBtn').addEventListener('click', () => {
        closeModal('rejectModal');
        openModal('detailsModal');
    });
    document.getElementById('rejectForm').addEventListener('submit', handleRejectFormSubmit);

    // REMOVED: document.getElementById('history-icon-btn').addEventListener('click', fetchAndDisplayHistory);
    // REMOVED: document.getElementById('closeHistoryModalBtn').addEventListener('click', () => { closeModal('historyModal'); });

    document.getElementById('closeDetailsModalBtn').addEventListener('click', () => {
        closeModal('detailsModal');
    });

    document.getElementById('closeImageZoomBtn').addEventListener('click', () => {
        closeModal('imageZoomModal');
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

    

    window.addEventListener('beforeunload', () => {
        clearInterval(pollingInterval);
    });
});