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
// New functions for button state management
function disableOtherMenuButtons() {
    const buttons = document.querySelectorAll('.menu-btn');
    buttons.forEach(button => {
        if (button.id !== 'mainSemesterBtn') {
            button.classList.add('disabled');
        }
    });
}

function enableAllMenuButtons() {
    const buttons = document.querySelectorAll('.menu-btn');
    buttons.forEach(button => {
        button.classList.remove('disabled');
    });
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


// Check for existing semester and display modal if none exists
async function checkSemesterStatus() {
    try {
        // Assume you have an endpoint to check the current semester
        const response = await fetch('/api/check-semester-status');
        const data = await response.json();
        
        if (!data.semesterSet) {
            // No semester set, open the initial setup modal and disable other buttons
            openCustomModal('modal-semester-initial');
            disableOtherMenuButtons();
        } else {
            // Semester is set, ensure all buttons are enabled
            enableAllMenuButtons();
        }
    } catch (error) {
        console.error('Error checking semester status:', error);
        // Fallback: If check fails, assume it needs setup or allow access if error isn't critical
        // For production, handle this more robustly.
        openCustomModal('modal-semester-initial');
        disableOtherMenuButtons();
    }
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    fetchUserProfile();
    checkSemesterStatus(); // Check on load

    const closeBtn = document.querySelector('#modal-semester-initial .close-initial-semester');
    if (closeBtn) {
        // Close button functionality (only close if absolutely necessary, but setup is required)
        closeBtn.onclick = () => {
            closeCustomModal('modal-semester-initial');
        };
    }

    // Handle form submission
    const form = document.getElementById('initialSemesterForm');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const semesterMessage = document.getElementById('semesterMessage');
        const setSemesterBtn = document.getElementById('setSemesterBtn');
        setSemesterBtn.disabled = true;
        semesterMessage.textContent = 'Processing... This may take a moment.';
        semesterMessage.style.color = '#00BFFF';

        const formData = new FormData(form);

        try {
            const response = await fetch('/api/initial-semester-setup', { // New endpoint
                method: 'POST',
                body: formData
            });

            const result = await response.json();

            if (response.ok) {
                semesterMessage.textContent = result.message || 'Semester and scholars successfully set!';
                semesterMessage.style.color = '#32CD32'; // Green for success
                // Crucial step: close modal and enable buttons on success
                setTimeout(() => {
                    closeCustomModal('modal-semester-initial');
                    enableAllMenuButtons();
                    // Optionally, refresh or redirect the user
                }, 2000); 
            } else {
                semesterMessage.textContent = result.message || 'Failed to set semester. Please check your file and try again.';
                semesterMessage.style.color = '#FF4500'; // Red for error
                setSemesterBtn.disabled = false;
            }
        } catch (error) {
            console.error('Initial semester setup error:', error);
            semesterMessage.textContent = 'A network error occurred. Please try again.';
            semesterMessage.style.color = '#FF4500';
            setSemesterBtn.disabled = false;
        }
    });
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






//CREATE SEMESTER
let allDepartments = [];
let allChurches = [];
let isSaving = false; 
let newSemesterData = {
    semester: null,
    scholarSlot: null,
    departments: [],
    churches: []
};
const temporaryDeptIdPrefix = 'temp_';
const temporaryChurchIdPrefix = 'temp_';

function openModal(modalId) {
    document.getElementById(modalId).style.display = 'block';
}

function closeModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
    const modal = document.getElementById(modalId);
    if (modal) {
        const form = modal.querySelector('form');
        if (form) {
            form.reset();
        }
    }
}


document.querySelectorAll('.modal').forEach(modal => {
    modal.onclick = (event) => {
        if (event.target === modal) {
            closeModal(modal.id);
        }
    };
});


document.getElementById('mainSemesterBtn').addEventListener('click', () => {
    openModal('mainSemesterModal');
});




document.getElementById('startNewSemesterOptionBtn').addEventListener('click', async () => {
    closeModal('mainSemesterModal');
    try {
        const response = await fetch('/send-otp-semester', {
            method: 'POST',
        });
        const result = await response.text();
        if (response.ok) {
            alert(result);
            openModal('otpModal');
        } else {
            alert(result);
        }
    } catch (error) {
        console.error('Error sending OTP:', error);
        alert('Failed to send OTP. Please try again.');
    }
});

// OTP SEMESTER
document.getElementById('otpForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const otp = document.getElementById('otpInput').value;
    const otpMessage = document.getElementById('otpMessage');

    try {
        const response = await fetch('/verify-otp-semester', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                otp
            }),
        });

        const result = await response.json();
        otpMessage.textContent = result.message;

        if (response.ok) {
            otpMessage.style.color = '#00BFFF';
            await fetchAllInitialData();
            setTimeout(() => {
                closeModal('otpModal');
                document.querySelector('#newSemesterModal h2').textContent = 'Set Semester Information';
                openModal('newSemesterModal');
            }, 1000);
        } else {
            otpMessage.style.color = '#00BFFF';
            document.getElementById('otpInput').value = '';
        }
    } catch (error) {
        console.error('Error verifying OTP:', error);
        otpMessage.textContent = 'An error occurred. Please try again.';
        otpMessage.style.color = 'red';
    }
});

async function fetchAllInitialData() {
    try {
        const [deptResponse, churchResponse] = await Promise.all([
            fetch('/get-all-departments'),
            fetch('/get-all-churches')
        ]);
        const deptData = await deptResponse.json();
        const churchData = await churchResponse.json();

        if (deptData.success) {
            allDepartments = deptData.departments;
        } else {
            console.error('Failed to fetch all departments.');
        }

        if (churchData.success) {
            allChurches = churchData.churches;
        } else {
            console.error('Failed to fetch all churches.');
        }

        newSemesterData.churches = allChurches.map(church => ({
            ...church,
            schedule: null 
        }));

        renderDepartmentList();
        renderChurchList();
        
    } catch (error) {
        console.error('Error fetching initial data:', error);
    }
}

document.getElementById('newSemesterForm').addEventListener('submit', (e) => {
    e.preventDefault();

    const semName = document.getElementById('semName').value;
    const dateEnd = document.getElementById('dateEnd').value;
    const gratis = document.getElementById('gratis').value;
    const fellowship = document.getElementById('fellowship').value;
    const penalty = document.getElementById('penalty').value;
    const sService = document.getElementById('sService').value;

    if (new Date(dateEnd) < new Date()) {
        alert("The end date cannot be in the past.");
        return;
    }

    newSemesterData.semester = {
        name: semName,
        endDate: dateEnd,
        gratis: parseInt(gratis),
        fellowship: parseInt(fellowship),
        penalty: parseInt(penalty),
        sService: parseInt(sService)
    };

    document.getElementById('newSemesterForm').classList.add('hidden');
    document.getElementById('semesterManagementContainer').classList.remove('hidden');
    document.getElementById('saveSemesterBtn').classList.remove('hidden');
    document.querySelector('#newSemesterModal h2').textContent = 'Set Semester Information';
    
    renderDepartmentList();
    renderChurchList();
    fetchSlotSummary();
});

const setScholarSlotBtn = document.getElementById("setScholarSlotBtn");
const scholarSlotInput = document.getElementById("scholarSlotInput");
const applyLastSlotBtn = document.getElementById("applyLastSlotBtn");

setScholarSlotBtn.addEventListener('click', () => {
    const limit_count = scholarSlotInput.value;
    if (limit_count === '' || isNaN(limit_count) || parseInt(limit_count) < 0) {
        alert('Please enter a valid number for scholar slots.');
        return;
    }
    newSemesterData.scholarSlot = {
        limit_count: parseInt(limit_count)
    };
    fetchSlotSummary();
});

applyLastSlotBtn.addEventListener('click', async () => {
    try {
        const response = await fetch('/get-last-scholar-slot');
        const result = await response.json();
        if (result.success) {
            scholarSlotInput.value = result.limit_count;
            newSemesterData.scholarSlot = {
                limit_count: result.limit_count
            };
            fetchSlotSummary();
        } else {
            alert(result.message);
        }
    } catch (error) {
        console.error('Error applying last slot:', error);
        alert('An error occurred while applying the last scholar slot.');
    }
});

function fetchSlotSummary() {
    const slotSummaryElement = document.getElementById('slotSummary');

    // Sum only non-Housekeeping department slots (housekeeping is "auto" => no fixed limit)
    const deptSlots = newSemesterData.departments.reduce((sum, dept) => {
        if (dept.deleted) return sum;
        if (dept.deptname.toLowerCase() === 'housekeeping') return sum;
        return sum + (dept.limit_count || 0);
    }, 0);

    const scholarSlot = newSemesterData.scholarSlot ? newSemesterData.scholarSlot.limit_count : 0;

    slotSummaryElement.textContent = `Dept Slots (excluding Housekeeping): ${deptSlots} / Scholar Slot: ${scholarSlot}`;

    if (deptSlots > scholarSlot) {
        slotSummaryElement.style.color = 'red';
        slotSummaryElement.textContent += ' (Exceeds Limit)';
    } else if (deptSlots === scholarSlot && scholarSlot > 0) {
        slotSummaryElement.style.color = 'green';
        slotSummaryElement.textContent += ' (Limit Reached)';
    } else {
        slotSummaryElement.style.color = '#ffd700';
        slotSummaryElement.textContent += ' (Available Slots)';
    }
}

const departmentListContainer = document.getElementById("departmentList");
const addDepartmentForm = document.getElementById("addDepartmentForm");
const showAddDeptFormBtn = document.getElementById("showAddDeptFormBtn");

showAddDeptFormBtn.addEventListener('click', () => {
    addDepartmentForm.classList.toggle('hidden');
});

addDepartmentForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const newDeptName = document.getElementById("newDeptName").value.trim();
    const newDeptSlot = parseInt(document.getElementById("newDeptSlot").value);

    if (!newDeptName || isNaN(newDeptSlot) || parseInt(newDeptSlot) < 0) {
        alert('Please enter a valid department name and slot count.');
        return;
    }
    if (allDepartments.find(dept => dept.deptname.toLowerCase() === newDeptName.toLowerCase())) {
        alert('A department with this name already exists.');
        return;
    }

    const tempId = 'temp_' + Date.now();
    newSemesterData.departments.push({
        deptname: newDeptName,
        limit_count: newDeptSlot,
        id: tempId
    });

    allDepartments.push({
        deptname: newDeptName,
        id: tempId
    });

    addDepartmentForm.reset();
    addDepartmentForm.classList.add('hidden');
    renderDepartmentList();
    fetchSlotSummary();
});

function renderDepartmentList() {
    departmentListContainer.innerHTML = '';
    const combinedDepts = allDepartments.map(dept => {
        const localDept = newSemesterData.departments.find(d => d.id === dept.id);
        if (localDept) {
            if (localDept.deleted) return null;
            return localDept;
        } else {
            const existingDept = newSemesterData.departments.find(d => d.deptname === dept.deptname);
            if (existingDept) {
                return {
                    id: dept.id,
                    deptname: dept.deptname,
                    limit_count: existingDept.limit_count
                };
            }
            return {
                id: dept.id,
                deptname: dept.deptname,
                limit_count: 0
            };
        }
    }).filter(d => d !== null);

    combinedDepts.sort((a, b) => a.deptname.localeCompare(b.deptname));

    combinedDepts.forEach(dept => {
        const isHousekeeping = dept.deptname.toLowerCase() === 'housekeeping';
        const limitValue = isHousekeeping ? 'auto' : dept.limit_count;

        const departmentItem = document.createElement('div');
        departmentItem.className = 'department-item';
        departmentItem.dataset.deptId = dept.id;
        departmentItem.dataset.deptName = dept.deptname;
        departmentItem.innerHTML = `
            <span class="dept-name">${dept.deptname}</span>
            <div class="dept-controls">
                ${
                  isHousekeeping
                    ? `<input type="text" value="auto" disabled>`
                    : `<input type="number" class="dept-slot-input" value="${limitValue}" min="0" required>`
                }
                <button class="action-btn icon-btn delete-btn" title="Delete">
                    <i class="fas fa-trash-alt"></i>
                </button>
            </div>
        `;
        departmentListContainer.appendChild(departmentItem);
    });
}

document.addEventListener('DOMContentLoaded', () => {
    setupDepartmentEventListeners();
    setupChurchEventListeners();

    // New event listener for Mainpage Management button
    const mpManageBtn = document.getElementById('mpManageBtn');
    if (mpManageBtn) {
        mpManageBtn.addEventListener('click', async () => {
            await fetchMainpageSettings();
            await fetchEvents();
            openCustomModal('mp-manage-modal');
        });
    }

    // New event listener for Add Event button
    const addEventBtn = document.getElementById('addEventBtn');
    if (addEventBtn) {
        addEventBtn.addEventListener('click', () => {
            // Reset the form before opening
            document.getElementById('eventPostForm').reset();
            // Set min date for eventDate to today
            const today = new Date().toISOString().split('T')[0];
            document.getElementById('eventDate').setAttribute('min', today);
            closeCustomModal('mp-manage-modal');
            openCustomModal('modal-event-post');
        });
    }

    // Event listener for Event Posting Form submission
    const eventPostForm = document.getElementById('eventPostForm');
    if (eventPostForm) {
        eventPostForm.addEventListener('submit', handleEventPost);
    }

    // Event listener for switch changes (Renewal and Application)
    document.getElementById('renewalSwitch').addEventListener('change', updateRenewalStatus);
    document.getElementById('applicationSwitch').addEventListener('change', updateApplicationStatus);

    // Event listener for Search Scholar button
    document.getElementById('searchScholarBtn').addEventListener('click', searchScholarForPrice);

    // Initial fetch for mainpage settings on load (optional, but good practice)
    fetchMainpageSettings();

    // --- Report Modal Elements (Updated to use IDs) ---
    const reportBtn = document.getElementById('reportBtn');
    const modalReport = document.getElementById('modal-report');
    const modalExit = document.querySelector('.modal-exit');
    const slidesContainer = document.getElementById('slides-container'); 
    const slideArrowLeft = document.getElementById('slide-arrow-left');
    const slideArrowRight = document.getElementById('slide-arrow-right');
    const downloadImgBtns = document.querySelectorAll('.download-img-btn');
    const tabButtons = document.querySelectorAll('.report-tab-btn');
    const downloadDocsBtn = document.getElementById('downloadDocsBtn');

    let currentActiveTab = 'department';

    // --- Modal Open/Close Logic ---
    reportBtn.onclick = async () => {
        modalReport.style.display = 'block';
        // Ensure the width is set before calculation
        // A short delay helps ensure the chart library has initialized the DOM elements
        await loadAllReportData(); // Fetch and render all data when modal opens
        setTimeout(updateSlideArrows, 50); // Initialize arrow state after slight delay
    };

    modalExit.onclick = () => {
        modalReport.style.display = 'none';
    };

    window.onclick = (event) => {
        if (event.target === modalReport) {
            modalReport.style.display = 'none';
        }
    };

    // ----------------------------------------------------------------------
    // --- SLIDE NAVIGATION LOGIC ---
    // ----------------------------------------------------------------------

    const updateSlideArrows = () => {
        if (!slidesContainer) return;
        // Check if the container is scrolled to the very left
        const isStart = slidesContainer.scrollLeft <= 1; // Tolerance for floating point math
        // Check if the container is scrolled to the very right
        const isEnd = slidesContainer.scrollLeft + slidesContainer.clientWidth >= slidesContainer.scrollWidth - 1;

        slideArrowLeft.style.display = isStart ? 'none' : 'block';
        slideArrowRight.style.display = isEnd ? 'none' : 'block';
    };

    const scrollSlides = (direction) => {
        // Get the width of the slide container *at the time of click*
        const SLIDE_WIDTH = slidesContainer.offsetWidth; 
        const scrollAmount = direction === 'right' ? SLIDE_WIDTH : -SLIDE_WIDTH;
        
        // Use smooth scroll behavior
        slidesContainer.scrollBy({
            left: scrollAmount,
            behavior: 'smooth'
        });
        
        // Update arrows after the scroll animation finishes (approx 300-400ms)
        setTimeout(updateSlideArrows, 400); 
    };

    // Event listeners for arrows
    if (slideArrowRight && slideArrowLeft) {
        slideArrowRight.addEventListener('click', () => scrollSlides('right'));
        slideArrowLeft.addEventListener('click', () => scrollSlides('left'));
    }
    
    // Update arrows whenever the user scrolls manually (e.g., using trackpad or mouse wheel)
    slidesContainer.addEventListener('scroll', updateSlideArrows);
    
    // ... (Chart functions: fetchReportData, loadAllReportData, 
    // loadSemesterChart, loadScheduleChart, loadLateGratisChart, loadTopDutyChart 
    // are assumed to be defined here and unchanged from the previous context)

    let semesterChart, scheduleChart, lateGratisChart, topDutyChart;

    const fetchReportData = async (endpoint) => {
        try {
            const response = await fetch(endpoint);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            return await response.json();
        } catch (error) {
            console.error(`Error fetching data from ${endpoint}:`, error);
            return null;
        }
    };

    const loadAllReportData = async () => {
        // Load Charts Data
        await loadSemesterChart();
        await loadScheduleChart();
        await loadLateGratisChart();
        await loadTopDutyChart();
        
        // Load Text Report Data
        await loadTextReport('department'); // Load default report
    };

    // --- Slide 1: Total Applicants per Semester (Stacked Column) ---
    const loadSemesterChart = async () => {
        const data = await fetchReportData('/api/report/applicants-by-semester');
        if (!data) return;

        const ctx = document.getElementById('semester-chart').getContext('2d');
        if (semesterChart) semesterChart.destroy();

        semesterChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: data.map(d => d.semname),
                datasets: [
                    {
                        label: 'Applicants (New)',
                        data: data.map(d => d.applicant_count),
                        backgroundColor: '#3498db',
                    },
                    {
                        label: 'Renewals',
                        data: data.map(d => d.renewal_count),
                        backgroundColor: '#2ecc71',
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        stacked: true,
                        title: { display: true, text: 'Semester' }
                    },
                    y: {
                        stacked: true,
                        beginAtZero: true,
                        title: { display: true, text: 'Total Count' }
                    }
                },
                plugins: {
                    title: { display: true, text: 'Total Applicants & Renewals (Last 4 Semesters)' }
                }
            }
        });
    };

    // --- Slide 2: Scholars per Schedule Day (Bar) ---
    const loadScheduleChart = async () => {
        const data = await fetchReportData('/api/report/scholars-by-schedule');
        if (!data) return;

        const ctx = document.getElementById('schedule-chart').getContext('2d');
        if (scheduleChart) scheduleChart.destroy();

        scheduleChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: data.map(d => d.day),
                datasets: [{
                    label: 'Total Schedule Slots Used',
                    data: data.map(d => d.count),
                    backgroundColor: '#e67e22',
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        title: { display: true, text: 'Total Schedule Entries' }
                    }
                },
                plugins: {
                    title: { display: true, text: 'Schedule Usage by Day (Current Sem)' }
                }
            }
        });
    };
    
    // --- Slide 3: Weekly Late Scholars (Line Graph) ---
    const loadLateGratisChart = async () => {
        const data = await fetchReportData('/api/report/weekly-late-gratis');
        if (!data) return;

        const ctx = document.getElementById('late-gratis-chart').getContext('2d');
        if (lateGratisChart) lateGratisChart.destroy();

        lateGratisChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: data.map(d => `Week ${d.week_number}`),
                datasets: [{
                    label: 'Count of Late Gratis Entries',
                    data: data.map(d => d.late_count),
                    borderColor: '#9b59b6',
                    tension: 0.1,
                    fill: false
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        title: { display: true, text: 'Count of Late Entries' }
                    },
                    x: {
                        title: { display: true, text: 'Last 6 Weeks' }
                    }
                },
                plugins: {
                    title: { display: true, text: 'Late Gratis Logs Over Last 6 Weeks' }
                }
            }
        });
    };

    // --- Slide 4: Top 5 Scholars by Total Duty (Bar) ---
    const loadTopDutyChart = async () => {
        const data = await fetchReportData('/api/report/top-duty-scholars');
        if (!data) return;

        const ctx = document.getElementById('top-duty-chart').getContext('2d');
        if (topDutyChart) topDutyChart.destroy();

        topDutyChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: data.map(d => d.fullname),
                datasets: [{
                    label: 'Total Duty Hours',
                    data: data.map(d => d.total_duty),
                    backgroundColor: [
                        '#e74c3c', // Top 1
                        '#f1c40f', // Top 2
                        '#1abc9c', // Top 3
                        '#3498db', // Top 4
                        '#95a5a6'  // Top 5
                    ],
                }]
            },
            options: {
                indexAxis: 'y', // Horizontal bars
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        beginAtZero: true,
                        title: { display: true, text: 'Total Duty (Units)' }
                    }
                },
                plugins: {
                    title: { display: true, text: 'Top 5 Scholars by Total Duty' }
                }
            }
        });
    };


    // --- Image Download (JPEG) for Slides (with white background) ---
    downloadImgBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const slideId = btn.getAttribute('data-slide');
            const canvas = document.querySelector(`#${slideId} canvas`);
            if (!canvas) {
                alert('Chart not found for download.');
                return;
            }

            // Create a temporary canvas to draw white background
            const tempCanvas = document.createElement('canvas');
            const ctx = tempCanvas.getContext('2d');
            tempCanvas.width = canvas.width;
            tempCanvas.height = canvas.height;

            // Fill background with white
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

            // Draw the original chart on top
            ctx.drawImage(canvas, 0, 0);

            // Export to JPEG
            const imageURL = tempCanvas.toDataURL('image/jpeg', 1.0);

            // Trigger download
            const a = document.createElement('a');
            a.href = imageURL;
            a.download = `${slideId}_report_chart.jpeg`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        });
    });


    // Helper function to create the member list
    const createMemberList = (members) => {
        if (members.length === 0 || (members.length === 1 && members[0] === '')) {
            return '<span class="member-list-item">None</span>';
        }
        // This maps the array of names to a list of vertical <span> elements
        return members.map(member => `<span class="member-list-item">${member}</span>`).join('');
    };

    const renderDepartmentReport = (data) => {
        const container = document.getElementById('department-report');
        container.innerHTML = '';
        downloadDocsBtn.style.display = 'block';

        if (!data || data.length === 0) {
            container.innerHTML = '<p>No departments found or no scholars assigned.</p>';
            return;
        }

        data.forEach(dept => {
            const item = document.createElement('div');
            item.className = 'department-report-item';
            
            const header = document.createElement('div');
            header.className = 'report-header-row';
            header.innerHTML = `<span>${dept.deptname}</span><span>Count: ${dept.count}</span>`;
            item.appendChild(header);

            const membersList = document.createElement('div');
            membersList.className = 'member-list';
            // Use the new helper function for vertical list
            membersList.innerHTML = '<strong>Members:</strong>' + createMemberList(dept.members);
            item.appendChild(membersList);

            container.appendChild(item);
        });
    };

    const renderChurchReport = (data) => {
        const container = document.getElementById('church-report');
        container.innerHTML = '';
        downloadDocsBtn.style.display = 'block';

        if (!data || data.length === 0) {
            container.innerHTML = '<p>No churches found or no scholars assigned.</p>';
            return;
        }

        data.forEach(church => {
            const item = document.createElement('div');
            item.className = 'church-report-item';
            
            const header = document.createElement('div');
            header.className = 'report-header-row';
            header.innerHTML = `<span>${church.chname}</span><span>Count: ${church.count}</span>`;
            item.appendChild(header);

            const membersList = document.createElement('div');
            membersList.className = 'member-list';
            // Use the new helper function for vertical list
            membersList.innerHTML = '<strong>Members:</strong>' + createMemberList(church.members);
            item.appendChild(membersList);

            container.appendChild(item);
        });
    };

    const loadTextReport = async (reportType) => {
        const container = document.getElementById(`${reportType}-report`);
        container.innerHTML = `<p>Loading ${reportType} Report...</p>`;
        
        const endpoint = reportType === 'department' 
            ? '/api/report/department-members' 
            : reportType === 'church' 
            ? '/api/report/church-members' 
            : null;

        if (endpoint) {
            const data = await fetchReportData(endpoint);
            if (data) {
                if (reportType === 'department') {
                    renderDepartmentReport(data);
                } else if (reportType === 'church') {
                    renderChurchReport(data);
                }
            } else {
                container.innerHTML = `<p>Failed to load ${reportType} report data.</p>`;
            }
        } else {
            // For Fellowship/Semester (no functionality yet)
            downloadDocsBtn.style.display = 'none';
        }
    };


    // Tab switching for text reports
    tabButtons.forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const targetTab = e.target.getAttribute('data-tab');

            // Update button styles
            tabButtons.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');

            // Switch content view
            document.querySelectorAll('.report-view').forEach(view => {
                view.style.display = 'none';
            });
            document.getElementById(`${targetTab}-report`).style.display = 'block';

            currentActiveTab = targetTab;

            // Load data only for Department and Church
            if (targetTab === 'department' || targetTab === 'church') {
                await loadTextReport(targetTab);
                downloadDocsBtn.style.display = 'block'; // Show for Department and Church
            } else {
                downloadDocsBtn.style.display = 'none'; // Hide for others
            }
        });
    });

    // --- Download as DOCS (UPDATED: Trigger Backend Download) ---
    downloadDocsBtn.addEventListener('click', () => {
        if (currentActiveTab === 'department' || currentActiveTab === 'church') {
            // 1. Construct the URL to the new backend endpoint
            const downloadUrl = `/api/report/download/${currentActiveTab}`;
            
            // 2. Setting window.location.href triggers a GET request to the URL.
            // Because the backend sets the 'Content-Disposition: attachment' header, 
            // the browser treats the response as a file download.
            window.location.href = downloadUrl;
        } else {
            // Note: Keeping alert() here as it was in the original snippet.
            alert('Document download is only available for Department and Church reports.');
        }
    });
});

function setupDepartmentEventListeners() {
    departmentListContainer.addEventListener('input', (event) => {
        if (event.target.classList.contains('dept-slot-input')) {
            const departmentItem = event.target.closest('.department-item');
            const deptId = departmentItem.dataset.deptId;
            const deptName = departmentItem.dataset.deptName;
            const newSlotCount = parseInt(event.target.value);

            if (isNaN(newSlotCount) || newSlotCount < 0) {
                return;
            }

            if (deptName.toLowerCase() === 'housekeeping') {
                // Ignore any changes to Housekeeping slots (should not happen since input disabled)
                return;
            }

            const existingDeptIndex = newSemesterData.departments.findIndex(d => d.id === deptId);
            if (existingDeptIndex !== -1) {
                newSemesterData.departments[existingDeptIndex].limit_count = newSlotCount;
            } else {
                newSemesterData.departments.push({
                    id: deptId,
                    deptname: deptName,
                    limit_count: newSlotCount
                });
            }
            fetchSlotSummary();
        }
    });

    departmentListContainer.addEventListener('click', (event) => {
        if (event.target.closest('.delete-btn')) {
            const departmentItem = event.target.closest('.department-item');
            const deptId = departmentItem.dataset.deptId;
            if (!confirm('Are you sure you want to delete this department? This action will be finalized when you save the semester.')) {
                return;
            }

            const existingDeptIndex = newSemesterData.departments.findIndex(d => d.id === deptId);
            if (existingDeptIndex !== -1) {
                newSemesterData.departments[existingDeptIndex].deleted = true;
            } else {
                newSemesterData.departments.push({
                    id: deptId,
                    deleted: true
                });
            }

            departmentItem.remove();
            alert('Department marked for deletion. Click "Save Semester" to finalize.');
            fetchSlotSummary();
        }
    });
}


const churchListContainer = document.getElementById("churchList");
const addChurchForm = document.getElementById("addChurchForm");
const showAddChurchFormBtn = document.getElementById("showAddChurchFormBtn");

showAddChurchFormBtn.addEventListener('click', () => {
    addChurchForm.classList.toggle('hidden');
});

addChurchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const newChurchName = document.getElementById("newChurchName").value.trim();
    if (!newChurchName) {
        alert('Please enter a valid church name.');
        return;
    }
    if (allChurches.find(church => church.chname.toLowerCase() === newChurchName.toLowerCase())) {
        alert('A church with this name already exists.');
        return;
    }

    const tempId = 'temp_' + Date.now();
    
    
    newSemesterData.churches.push({
        chname: newChurchName,
        id: tempId,
        schedule: null 
    });

    
    allChurches.push({ chname: newChurchName, id: tempId });
    addChurchForm.reset();
    addChurchForm.classList.add('hidden');
    renderChurchList();
});

function formatTime(timeString) {
    if (!timeString) return '';
    return timeString.slice(0, 5);
}

function renderChurchList() {
    churchListContainer.innerHTML = '';
    const combinedChurches = allChurches.map(church => {
        const localChurch = newSemesterData.churches.find(c => c.id === church.id);
        
        if (localChurch && localChurch.deleted) return null;
        
        const schedule = (localChurch && localChurch.schedule) ? localChurch.schedule : {
            sched: 'Mon',
            time_start: '',
            time_stop: ''
        };
        
        return {
            id: church.id,
            chname: church.chname,
            schedule: schedule
        };
    }).filter(c => c !== null);

    combinedChurches.sort((a, b) => a.chname.localeCompare(b.chname));

    combinedChurches.forEach(church => {
        const churchItem = document.createElement('div');
        churchItem.className = 'church-item';
        churchItem.dataset.churchId = church.id;
        churchItem.innerHTML = `
            <span class="church-name">${church.chname}</span>
            <div class="schedule-controls">
                <select class="schedule_day">
                    <option value="Mon" ${church.schedule.sched === 'Mon' ? 'selected' : ''}>Monday</option>
                    <option value="Tue" ${church.schedule.sched === 'Tue' ? 'selected' : ''}>Tuesday</option>
                    <option value="Wed" ${church.schedule.sched === 'Wed' ? 'selected' : ''}>Wednesday</option>
                    <option value="Thu" ${church.schedule.sched === 'Thu' ? 'selected' : ''}>Thursday</option>
                    <option value="Fri" ${church.schedule.sched === 'Fri' ? 'selected' : ''}>Friday</option>
                    <option value="Sat" ${church.schedule.sched === 'Sat' ? 'selected' : ''}>Saturday</option>
                </select>
                <input type="time" class="time_start" value="${formatTime(church.schedule.time_start)}">
                <input type="time" class="time_stop" value="${formatTime(church.schedule.time_stop)}">
                
                <button class="action-btn icon-btn save-btn" title="Save Schedule">
                    <i class="fas fa-save"></i>
                </button>
                
                <button class="action-btn icon-btn delete-btn" title="Delete Church">
                    <i class="fas fa-trash-alt"></i>
                </button>
            </div>
        `;
        churchListContainer.appendChild(churchItem);
    });
}

function setupChurchEventListeners() {
    churchListContainer.addEventListener('click', (event) => {
        if (event.target.closest('.save-btn')) {
            const button = event.target.closest('.save-btn');
            const churchItem = button.closest('.church-item');
            const churchId = churchItem.dataset.churchId;
            const day = churchItem.querySelector('.schedule_day').value;
            const startTime = churchItem.querySelector('.time_start').value;
            const endTime = churchItem.querySelector('.time_stop').value;

            if (!startTime || !endTime) {
                alert("Please select both a start and end time.");
                return;
            }
            if (startTime >= endTime) {
                alert("Start time cannot be at or after the end time.");
                return;
            }

            
            const hasConflict = newSemesterData.churches.some(church => {
                if (church.id == churchId) {
                    return false;
                }
                
                if (church.schedule && church.schedule.sched === day) {
                    const localSchedule = church.schedule;
                    const isConflicting = (startTime < formatTime(localSchedule.time_stop) && endTime > formatTime(localSchedule.time_start));
                    return isConflicting;
                }
                
                return false;
            });

            if (hasConflict) {
                alert('A conflicting schedule has been set locally for another church on this day and time. Please resolve it first.');
                return;
            }
            
            const churchIndex = newSemesterData.churches.findIndex(c => c.id == churchId);

            if (churchIndex !== -1) {
                newSemesterData.churches[churchIndex].schedule = {
                    sched: day,
                    time_start: startTime + ':00',
                    time_stop: endTime + ':00'
                };
            } else {
                const churchFromGlobal = allChurches.find(c => c.id == churchId);
                
                if (churchFromGlobal) {
                     newSemesterData.churches.push({
                         id: churchId,
                         chname: churchFromGlobal.chname,
                         schedule: {
                             sched: day,
                             time_start: startTime + ':00',
                             time_stop: endTime + ':00'
                         }
                     });
                } else {
                    console.error("Church not found in any list:", churchId);
                    alert("An error occurred. Church not found.");
                    return;
                }
            }
            
            alert('Church schedule saved locally. Click "Save Semester" to finalize.');
        }

        if (event.target.closest('.delete-btn')) {
            const churchItem = event.target.closest('.church-item');
            const churchId = churchItem.dataset.churchId;

            if (!confirm('Are you sure you want to delete this church? This action will be finalized when you save the semester.')) {
                return;
            }

            const existingChurchIndex = newSemesterData.churches.findIndex(c => c.id === churchId);
            if (existingChurchIndex !== -1) {
                newSemesterData.churches[existingChurchIndex].deleted = true;
            } else {
                newSemesterData.churches.push({
                    id: churchId,
                    deleted: true
                });
            }

            churchItem.remove();
            alert('Church marked for deletion. Click "Save Semester" to finalize.');
        }
    });
}

document.getElementById('saveSemesterBtn').addEventListener('click', async () => {
    if (isSaving) {
        alert('Save operation is already in progress. Please wait.');
        return;
    }
    
    
    if (!newSemesterData.semester) {
        alert('Please set the semester information first.');
        return;
    }
    if (!newSemesterData.scholarSlot) {
        alert('Please set the total scholar slots first.');
        return;
    }
    if (newSemesterData.departments.filter(d => !d.deleted).length === 0) {
        alert('Please add at least one department with scholar slots before saving.');
        return;
    }
    if (newSemesterData.churches.filter(c => !c.deleted).length === 0) {
        alert('Please add at least one church schedule before saving.');
        return;
    }

    const churchesWithoutSchedule = newSemesterData.churches.filter(church => 
        !church.deleted && (!church.schedule || !church.schedule.sched || !church.schedule.time_start || !church.schedule.time_stop)
    );

    if (churchesWithoutSchedule.length > 0) {
        const churchNames = churchesWithoutSchedule.map(c => c.chname).join(', ');
        alert(`The following churches do not have a complete schedule: ${churchNames}. Please set a schedule for them before saving.`);
        return;
    }
    
    // === Insert Housekeeping if missing ===
    if (!newSemesterData.departments.find(d => d.deptname.toLowerCase() === 'housekeeping')) {
        newSemesterData.departments.push({
            id: 1,  // or use housekeepingId if you have that variable
            deptname: 'Housekeeping',
            limit_count: null
        });
    }
    
    const deptSlots = newSemesterData.departments.reduce((sum, dept) => sum + (dept.deleted ? 0 : (dept.limit_count || 0)), 0);
    const scholarSlot = newSemesterData.scholarSlot ? newSemesterData.scholarSlot.limit_count : 0;
    
    if (deptSlots > scholarSlot) {
        alert('Department slots exceed the total scholar slots. Please adjust before saving.');
        return;
    }

    isSaving = true;
    
    try {
        const response = await fetch('/save-semester-transaction', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(newSemesterData)
        });

        const result = await response.json();
        alert(result.message);

        if (result.success) {
            closeModal('newSemesterModal');

            newSemesterData = {
                semester: null,
                scholarSlot: null,
                departments: [],
                churches: []
            };
            document.getElementById('newSemesterForm').reset();
            document.getElementById('newSemesterForm').classList.remove('hidden');
            document.getElementById('semesterManagementContainer').classList.add('hidden');
            document.getElementById('saveSemesterBtn').classList.add('hidden');
        }
    } catch (error) {
        console.error('Error saving semester transaction:', error);
        alert('An error occurred while saving the semester. Please try again.');
    } finally {
        isSaving = false;
    }
});

const originalCloseModal = window.closeModal;
window.closeModal = function(modalId) {
    if (modalId === 'newSemesterModal' && !isSaving) {
        const confirmClose = confirm('Are you sure you want to close? All unsaved changes will be lost.');
        if (confirmClose) {
            newSemesterData = {
                semester: null,
                scholarSlot: null,
                departments: [],
                churches: []
            };
            document.getElementById('newSemesterForm').classList.remove('hidden');
            document.getElementById('semesterManagementContainer').classList.add('hidden');
            document.getElementById('saveSemesterBtn').classList.add('hidden');
            document.getElementById('newSemesterForm').reset();
            document.getElementById('otpInput').value = '';
            document.getElementById('otpMessage').textContent = '';
            originalCloseModal(modalId);
        }
    } else {
        originalCloseModal(modalId);
    }
};

//CURRENT SEM
document.getElementById('currentSemesterBtn').addEventListener('click', async () => {
    closeModal('mainSemesterModal'); 
    try {
        const response = await fetch('/get-current-semester-details');
        if (response.ok) {
            const data = await response.json();
            populateCurrentSemesterModal(data);
            openModal('currentSemesterInfoModal');
        } else {
            const errorText = await response.text();
            alert(errorText);
        }
    } catch (error) {
        console.error('Error fetching current semester details:', error);
        alert('An error occurred while fetching current semester details.');
    }
});

function populateCurrentSemesterModal(data) {
    const semester = data.semester; 

   
    document.querySelector('#currentSemesterInfoModal h2').textContent = `Current Semester: ${semester.semname}`;
    document.getElementById('currentSemName').textContent = semester.semname;
    document.getElementById('currentDateStart').textContent = new Date(semester.datestart).toLocaleDateString();
    document.getElementById('currentDateEnd').textContent = new Date(semester.dateend).toLocaleDateString();
    document.getElementById('currentGratis').textContent = semester.gratis;
    document.getElementById('currentFellowship').textContent = semester.fellowship;
    document.getElementById('currentPenalty').textContent = semester.penalty;
    document.getElementById('currentSService').textContent = semester.sService;

   
    document.getElementById('currentScholarSlot').value = data.scholarSlot ? data.scholarSlot.limit_count : 0;

    const deptList = document.getElementById('currentDeptList');
    deptList.innerHTML = '';
    data.departments.forEach(dept => {
        const deptItem = document.createElement('div');
        deptItem.className = 'department-item';
        
        deptItem.innerHTML = `<p><strong>${dept.deptname}:</strong> ${dept.limit_count} slots</p>`;
        deptList.appendChild(deptItem);
    });

    const fullDayNames = {
        'Mon': 'Monday',
        'Tue': 'Tuesday',
        'Wed': 'Wednesday',
        'Thu': 'Thursday',
        'Fri': 'Friday',
        'Sat': 'Saturday'
    };
    const churchList = document.getElementById('currentChurchList');
    churchList.innerHTML = '';
    data.churches.forEach(church => {
        const churchItem = document.createElement('div');
        churchItem.className = 'church-item';

        
        const timeStart = new Date(`1970-01-01T${church.time_start}`).toLocaleTimeString([], {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
        const timeStop = new Date(`1970-01-01T${church.time_stop}`).toLocaleTimeString([], {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });

        
        const fullDayName = fullDayNames[church.sched] || church.sched;

        churchItem.innerHTML = `<p><strong>${church.chname}:</strong> ${fullDayName} ${timeStart} - ${timeStop}</p>`;
        churchList.appendChild(churchItem);
    });
}



// EXTEND SEMESTER
document.getElementById('extendSemesterBtn').addEventListener('click', () => {
    openModal('extendSemesterModal');
});


document.getElementById('extendSemesterForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const newEndDate = document.getElementById('newEndDate').value;
    try {
        const response = await fetch('/extend-semester', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ newEndDate })
        });
        const result = await response.json();
        alert(result.message);
        if (result.success) {
            closeModal('extendSemesterModal');
           
            document.getElementById('currentSemesterBtn').click();
        }
    } catch (error) {
        console.error('Error extending semester:', error);
        alert('An error occurred while extending the semester.');
    }
});




//Create Account
document.getElementById('openAccountModalBtn').addEventListener('click', async () => {
    try {
        const response = await fetch('/send-otp-account', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        });

        const result = await response.json();
        
        if (response.ok) {
            alert(result.message);
            openModal('accountOtpModal'); 
        } else {
            alert(result.message || 'Failed to send OTP. Please try again.');
        }

    } catch (error) {
        console.error('Error sending OTP for account creation:', error);
        alert('An error occurred. Please try again.');
    }
});


//OTP for account
document.getElementById('accountOtpForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const otp = document.getElementById('accountOtpInput').value;
    const otpMessage = document.getElementById('accountOtpMessage');

    try {
        const response = await fetch('/verify-otp-account', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ otp }),
        });

        const result = await response.json();
        otpMessage.textContent = result.message;

        if (response.ok) {
            otpMessage.style.color = 'green';
            setTimeout(() => {
                closeModal('accountOtpModal');
                openModal('createAccountModal'); 
            }, 1000);
        } else {
            otpMessage.style.color = 'red';
            document.getElementById('accountOtpInput').value = '';
        }
    } catch (error) {
        console.error('Error verifying OTP:', error);
        otpMessage.textContent = 'An error occurred. Please try again.';
        otpMessage.style.color = 'red';
    }
});

const openAccountModalBtn = document.getElementById("openAccountModalBtn");
const roleSelect = document.getElementById("role");
const churchSelect = document.getElementById("church");
const churchSelectContainer = document.getElementById("churchSelectContainer");

// Account Creation
async function fetchRolesAndChurches() {
    try {
        const [rolesResponse, churchesResponse] = await Promise.all([
            fetch("/get-roles"),
            fetch("/get-churches")
        ]);

        const roles = await rolesResponse.json();
        const churches = await churchesResponse.json();

        
        roleSelect.innerHTML = '<option value="">Select Role</option>';
        roles.forEach(role => {
            const option = document.createElement("option");
            option.value = role.id;
            option.textContent = role.role;
            roleSelect.appendChild(option);
        });

        
        churchSelect.innerHTML = '<option value="">Select Church</option>';
        churches.forEach(church => {
            const option = document.createElement("option");
            option.value = church.id;
            option.textContent = church.chname;
            churchSelect.appendChild(option);
        });

    } catch (error) {
        console.error("Error fetching data:", error);
        alert("Failed to load roles and churches.");
    }
}

// Church in Account Creation
roleSelect.addEventListener("change", () => {
    const selectedRole = roleSelect.options[roleSelect.selectedIndex].text;
    if (selectedRole.includes('CH PERSONNEL')) {
        churchSelectContainer.style.display = 'block';
        churchSelect.required = true;
    } else {
        churchSelectContainer.style.display = 'none';
        churchSelect.required = false;
    }
});

openAccountModalBtn.onclick = () => {
    fetchRolesAndChurches();
    openAccountModalBtn.onclick = () => {
        openModal('createAccountModal');
    };
};

document.getElementById("createAccountForm").addEventListener("submit", async (e) => {
    e.preventDefault();

    const data = {
        surname: document.getElementById("surname").value,
        firstname: document.getElementById("firstname").value,
        email: document.getElementById("email").value,
        role: document.getElementById("role").value
    };

    if (churchSelectContainer.style.display === 'block') {
        data.church = document.getElementById("church").value;
    }

    try {
        const response = await fetch("/create-account", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(data)
        });
        const result = await response.json();
        alert(result.message);
        if (response.ok) closeModal('createAccountModal');
    } catch (error) {
        console.error("Error creating account:", error);
        alert("Failed to create account.");
    }
});



// MULTIPLE ACCOUNTS
document.getElementById('uploadExcelBtn').addEventListener('click', () => {
    document.getElementById('excelFileInput').click();
});


document.getElementById('excelFileInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) {
        return;
    }

    const formData = new FormData();
    formData.append('excelFile', file);

    try {
        const response = await fetch('/create-multiple-accounts', {
            method: 'POST',
            body: formData,
        });

        const result = await response.json();
        alert(result.message);
        if (response.ok) {
            closeModal('createAccountModal');
            
        }

    } catch (error) {
        console.error('Error uploading Excel file:', error);
        alert('An error occurred while uploading the file. Please try again.');
    } finally {
        
        document.getElementById('excelFileInput').value = '';
    }
});

//Violation
let violationLogsData = [];

// Function to render the violation logs in the modal
function renderViolationLogs(logs) {
    const logBody = document.getElementById('violationLogBody');
    logBody.innerHTML = ''; // Clear previous data

    if (logs.length === 0) {
        logBody.innerHTML = '<p style="text-align: center;">No "With Violation" logs found for the current semester.</p>';
        return;
    }

    logs.forEach(log => {
        const row = document.createElement('div');
        row.className = 'violation-row';
        row.innerHTML = `
            <div class="col-name">${log.scholar_name}</div>
            <div class="col-reason">${log.violation_reason}</div>
            <div class="col-validator">${log.assigned_validator_name}</div>
            <div class="col-action">
                <button class="revert-btn" data-log-id="${log.log_id}">Revert</button>
            </div>
        `;
        logBody.appendChild(row);
    });

    // Attach event listeners to the new Revert buttons
    document.querySelectorAll('.revert-btn').forEach(button => {
        button.addEventListener('click', handleRevertViolation);
    });
}

// Function to populate the date filter (from fetched data)
function populateDateFilter(logs) {
    const dateFilter = document.getElementById('violationDateFilter');
    dateFilter.innerHTML = '<option value="">DATE</option>'; // Reset

    const uniqueDates = [...new Set(logs.map(log => log.monitoring_date))];
    uniqueDates.sort((a, b) => new Date(b) - new Date(a)); // Sort latest first

    uniqueDates.forEach(date => {
        const option = document.createElement('option');
        option.value = date;
        option.textContent = date;
        dateFilter.appendChild(option);
    });
}

// --- OTP LOGIC FOR VIOLATION MANAGEMENT ---

// Step 1: Click the Violation Management button -> Send OTP
document.getElementById('violationManagementBtn').addEventListener('click', async () => {
    try {
        const response = await fetch('/send-otp-violation', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        });

        const result = await response.json();
        
        if (response.ok) {
            alert(result.message);
            openModal('violationOtpModal'); // Step 2: Open OTP modal
        } else {
            alert(result.message || 'Failed to send OTP. Please try again.');
        }

    } catch (error) {
        console.error('Error sending OTP for violation management:', error);
        alert('An error occurred. Please try again.');
    }
});


// Step 2: Verify OTP
document.getElementById('violationOtpForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const otp = document.getElementById('violationOtpInput').value;
    const otpMessage = document.getElementById('violationOtpMessage');

    try {
        const response = await fetch('/verify-otp-violation', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ otp }),
        });

        const result = await response.json();
        otpMessage.textContent = result.message;

        if (response.ok) {
            otpMessage.style.color = 'green';
            // Step 3: If correct, fetch data and display the main modal
            await fetchAndDisplayViolations();
            
            setTimeout(() => {
                closeModal('violationOtpModal');
                document.getElementById('violationOtpInput').value = ''; // Clear input
            }, 1000);

        } else {
            otpMessage.style.color = 'red';
            document.getElementById('violationOtpInput').value = '';
        }
    } catch (error) {
        console.error('Error verifying OTP:', error);
        otpMessage.textContent = 'An error occurred. Please try again.';
        otpMessage.style.color = 'red';
    }
});
// Function to get the current date in YYYY-MM-DD format
function getCurrentDateFormatted() {
    const today = new Date();
    // Use .toISOString() and slice to get YYYY-MM-DD reliably
    return today.toISOString().slice(0, 10);
}

// Fetch and Display Violations
async function fetchAndDisplayViolations() {
    try {
        const response = await fetch('/violation-logs');
        const logs = await response.json();

        if (response.ok) {
            violationLogsData = logs; // Store all logs for local filtering
            populateDateFilter(logs); // Populate the date dropdown

            // --- NEW LOGIC TO DEFAULT TO CURRENT DATE ---
            const currentDate = getCurrentDateFormatted();
            const dateFilterElement = document.getElementById('violationDateFilter');

            // 1. Set the date filter to the current date (if that date exists in the logs)
            // If the current date is not present, it will default to 'DATE' (empty value)
            if (logs.some(log => log.monitoring_date === currentDate)) {
                dateFilterElement.value = currentDate;
            } else {
                // If no logs for today, ensure the filter is reset to show all or 'DATE'
                dateFilterElement.value = ''; 
            }
            
            // 2. Filter the logs based on the initial state of the dropdown
            const nameSearch = document.getElementById('violationNameSearch').value.toLowerCase(); // Get current search value
            const defaultDateFilter = dateFilterElement.value; // Get the default or selected date

            const defaultFilteredLogs = violationLogsData.filter(log => {
                const matchesDate = defaultDateFilter === '' || log.monitoring_date === defaultDateFilter;
                const matchesName = log.scholar_name.toLowerCase().includes(nameSearch);
                return matchesDate && matchesName;
            });
            
            renderViolationLogs(defaultFilteredLogs); // Display the filtered logs
            // --- END NEW LOGIC ---

            openModal('violationLogModal');
        } else {
            alert(logs.message || 'Failed to fetch violation logs.');
        }
    } catch (error) {
        console.error('Error fetching violation logs:', error);
        alert('An error occurred while loading violation data.');
    }
}

// --- SEARCH/FILTER LOGIC ---
document.getElementById('violationSearchBtn').addEventListener('click', () => {
    const dateFilter = document.getElementById('violationDateFilter').value;
    const nameSearch = document.getElementById('violationNameSearch').value.toLowerCase();

    const filteredLogs = violationLogsData.filter(log => {
        const matchesDate = dateFilter === '' || log.monitoring_date === dateFilter;
        const matchesName = log.scholar_name.toLowerCase().includes(nameSearch);
        return matchesDate && matchesName;
    });

    renderViolationLogs(filteredLogs);
});

// Handle change on date filter as well
document.getElementById('violationDateFilter').addEventListener('change', () => {
    // Trigger the search logic
    document.getElementById('violationSearchBtn').click();
});


// --- REVERT BUTTON LOGIC ---
async function handleRevertViolation(event) {
    const logId = event.target.dataset.logId;
    
    if (!confirm(`Are you sure you want to REVERT violation for Log ID: ${logId}? This action cannot be undone.`)) {
        return; // User cancelled
    }

    try {
        const response = await fetch(`/revert-violation/${logId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        });

        const result = await response.json();

        if (response.ok) {
            alert(result.message);
            // Re-fetch and display the updated list
            await fetchAndDisplayViolations();
        } else {
            alert(result.message || 'Failed to revert violation.');
        }

    } catch (error) {
        console.error('Error reverting violation:', error);
        alert('An error occurred during the revert process.');
    }
}

// fellowship
// Function to show and hide modals
const churchModal = document.getElementById('churchModal');
const changeDateModal = document.getElementById('changeDateModal');
const churchBtn = document.getElementById('churchBtn');
const addFellowshipBtn = document.getElementById('addFellowshipBtn');
const saveNewDateTimeBtn = document.getElementById('saveNewDateTimeBtn');

// Helper to get today's date in YYYY-MM-DD format for min attribute
function getTodayDate() {
    const today = new Date();
    // Add one day to ensure only upcoming days can be selected
    today.setDate(today.getDate() + 1); 
    const dd = String(today.getDate()).padStart(2, '0');
    const mm = String(today.getMonth() + 1).padStart(2, '0'); // January is 0!
    const yyyy = today.getFullYear();
    return yyyy + '-' + mm + '-' + dd;
}

// Set minimum date for the new fellowship date input
document.getElementById('selectDate').setAttribute('min', getTodayDate());

// --- MODAL OPEN/CLOSE LOGIC ---
churchBtn.onclick = async function() {
    churchModal.style.display = 'block';
    await loadChurches(); // Load church options
    await loadFellowships(); // Load existing fellowships
}

document.querySelector('#churchModal .close-btn').onclick = function() {
    churchModal.style.display = 'none';
}

document.querySelector('#changeDateModal .close-btn-change').onclick = function() {
    changeDateModal.style.display = 'none';
}

// --- UPDATED WINDOW.ONCLICK LOGIC ---
// This assumes your old window.onclick logic handles dropdowns/other modals.
// We are replacing the previous simple event.target checks with the new class checks 
// for the fellowship modals, assuming they now have 'modal-fellowship' and 'modal-change-date' classes.
window.onclick = function(event) {
    // Check if the click is on the modal backdrop using the new specific class names
    if (event.target.classList.contains('modal-fellowship')) {
        churchModal.style.display = 'none';
    }
    if (event.target.classList.contains('modal-change-date')) {
        changeDateModal.style.display = 'none';
    }
    
    // NOTE: If you have existing window.onclick logic for other elements 
    // (like the hamburger menu or other modals), you must merge it here:
    /*
    if (!event.target.matches('.hamburger, .hamburger div')) {
        // ... dropdown closing logic ...
    }
    
    if (event.target.classList.contains('modal-other')) { 
        event.target.style.display = 'none';
    }
    */
}
// --- END OF UPDATED WINDOW.ONCLICK LOGIC ---

// --- ASYNC DATA LOADING ---

/** Loads all churches and populates the dropdown. */
async function loadChurches() {
    try {
        const response = await fetch('/api/churches');
        if (!response.ok) throw new Error('Failed to fetch churches');
        const churches = await response.json();
        
        const selectChurch = document.getElementById('selectChurch');
        // Clear previous options except the first placeholder
        selectChurch.innerHTML = '<option value="">Select Church</option>'; 

        churches.forEach(church => {
            const option = document.createElement('option');
            option.value = church.id;
            option.textContent = church.chname;
            selectChurch.appendChild(option);
        });

    } catch (error) {
        console.error('Error loading churches:', error);
        alert('Failed to load church list.');
    }
}

/** Loads existing fellowships and renders them. */
async function loadFellowships() {
    try {
        const response = await fetch('/api/fellowships');
        if (!response.ok) throw new Error('Failed to fetch fellowships');
        const fellowships = await response.json();

        const listContainer = document.getElementById('fellowshipsList');
        // Remove old dynamic rows, keeping the header row
        const oldRows = listContainer.querySelectorAll('.fellowship-data-row');
        oldRows.forEach(row => row.remove());

        // Sort by Date (most recent on top)
        fellowships.sort((a, b) => new Date(b.fellowship) - new Date(a.fellowship));

        // Get today's date (no time)
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Render each fellowship row
        fellowships.forEach(f => {
            const fellowshipDate = new Date(f.fellowship);
            fellowshipDate.setHours(0, 0, 0, 0);

            const isPast = fellowshipDate <= today; // ✅ true if past or today

            const row = document.createElement('div');
            row.className = 'fellowship-data-row';
            row.innerHTML = `
                <span>${f.title}</span>
                <span>${f.chname}</span>
                <span>${f.type_fellowship}</span>
                <span>${new Date(f.fellowship).toLocaleDateString()}</span>
                <span>${f.time_start.substring(0, 5)}</span>
                <span>
                    <button class="change-date-btn" 
                        data-id="${f.id}" 
                        data-date="${f.fellowship}" 
                        data-time="${f.time_start}"
                        ${isPast ? 'disabled' : ''}>
                        Change Date
                    </button>
                </span>
            `;
            listContainer.appendChild(row);

            // Apply visual disabling (gray, non-clickable)
            if (isPast) {
                const btn = row.querySelector('.change-date-btn');
                btn.style.backgroundColor = '#ccc';
                btn.style.cursor = 'not-allowed';
                btn.style.pointerEvents = 'none'; // hard disable
                btn.title = 'Cannot change date for past or current fellowships';
            }
        });

        // Attach event listener only for active buttons
        document.querySelectorAll('.change-date-btn:not([disabled])').forEach(button => {
            button.onclick = openChangeDateModal;
        });

    } catch (error) {
        console.error('Error loading fellowships:', error);
        document.getElementById('fellowshipsList').insertAdjacentHTML(
            'beforeend',
            '<p>Could not load existing fellowships.</p>'
        );
    }
}


// --- ADD FELLOWSHIP LOGIC ---
addFellowshipBtn.onclick = async function() {
    const title = document.getElementById('fellowshipTitle').value.trim();
    const ch_id = document.getElementById('selectChurch').value;
    const type_fellowship = document.getElementById('typeOfFellowship').value;
    const fellowshipDate = document.getElementById('selectDate').value;
    const time_start = document.getElementById('selectTimeStart').value;

    if (!title || !ch_id || !type_fellowship || !fellowshipDate || !time_start) {
        return alert('Please fill in all fields for the new fellowship.');
    }

    try {
        const response = await fetch('/api/fellowships', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, ch_id, type_fellowship, fellowship: fellowshipDate, time_start })
        });

        const result = await response.json();

        if (response.ok) {
            alert(result.message);
            // Clear inputs and reload list
            document.getElementById('fellowshipTitle').value = '';
            document.getElementById('selectChurch').value = '';
            document.getElementById('typeOfFellowship').value = '';
            document.getElementById('selectDate').value = '';
            document.getElementById('selectTimeStart').value = '';
            await loadFellowships();
        } else {
            alert('Failed to add fellowship: ' + result.message);
        }
    } catch (error) {
        console.error('Error adding fellowship:', error);
        alert('An unexpected error occurred while adding the fellowship.');
    }
};

// --- CHANGE DATE MODAL LOGIC ---

/** Opens the modal to change a fellowship's date/time. */
function openChangeDateModal(event) {
    const button = event.target;
    const fId = button.getAttribute('data-id');
    const currentDate = button.getAttribute('data-date');
    const currentTime = button.getAttribute('data-time').substring(0, 5); // Format time to HH:MM

    document.getElementById('fellowshipToUpdateId').value = fId;
    
    // Pre-populate with current values (optional, but helpful for UX)
    document.getElementById('newDate').value = currentDate;
    document.getElementById('newTime').value = currentTime;
    
    // Set minimum date for the new date input
    document.getElementById('newDate').setAttribute('min', getTodayDate());

    changeDateModal.style.display = 'block';
}

/** Handles the saving of the new date/time for a fellowship. */
saveNewDateTimeBtn.onclick = async function() {
    const id = document.getElementById('fellowshipToUpdateId').value;
    const newDate = document.getElementById('newDate').value;
    const newTime = document.getElementById('newTime').value;

    if (!newDate || !newTime) {
        return alert('Please select both a new date and time.');
    }

    try {
        const response = await fetch(`/api/fellowships/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fellowship: newDate, time_start: newTime })
        });

        const result = await response.json();

        if (response.ok) {
            alert(result.message);
            changeDateModal.style.display = 'none';
            await loadFellowships(); // Reload the list
        } else {
            alert('Failed to update fellowship: ' + result.message);
        }

    } catch (error) {
        console.error('Error updating fellowship:', error);
        alert('An unexpected error occurred while updating the fellowship.');
    }
};

//request
// adminDash.js

// Global variable to store the details of the request currently being viewed
let currentRequestData = null;

// --- Modal Elements ---
const requestModal = document.getElementById('requestModal');
const requestBtn = document.getElementById('requestBtn');
const closeBtnRequest = document.querySelector('.close-btn-request');
const requestListContainer = document.getElementById('requestListContainer');
const requestDetailContainer = document.getElementById('requestDetailContainer');
const detailName = document.getElementById('detailName');
const detailReason = document.getElementById('detailReason');
const detailFellowshipDate = document.getElementById('detailFellowshipDate');
const acceptBtn = document.getElementById('acceptBtn');
const rejectBtn = document.getElementById('rejectBtn');

// --- Event Listeners ---
requestBtn.addEventListener('click', () => {
    // Reset to list view and open modal
    requestDetailContainer.style.display = 'none';
    requestListContainer.style.display = 'block'; 
    fetchPendingRequests();
    requestModal.style.display = 'block';
});

closeBtnRequest.addEventListener('click', () => {
    requestModal.style.display = 'none';
    // Reset the inner view when closing
    requestListContainer.style.display = 'block';
    requestDetailContainer.style.display = 'none';
});

window.addEventListener('click', (event) => {
    if (event.target === requestModal) {
        requestModal.style.display = 'none';
        // Reset the inner view when clicking outside
        requestListContainer.style.display = 'block';
        requestDetailContainer.style.display = 'none';
    }
});

acceptBtn.addEventListener('click', () => handleDecision('Approve'));
rejectBtn.addEventListener('click', () => handleDecision('Rejected'));

// --- Functions ---

/**
 * Fetches and displays ALL pending requests (Absent and Exit).
 */
async function fetchPendingRequests() {
    try {
        // *** UPDATED ENDPOINT ***
        const response = await fetch('/api/admin/pending-requests');
        const data = await response.json();

        requestListContainer.innerHTML = ''; // Clear previous list
        
        // Ensure the list view is visible before populating
        requestDetailContainer.style.display = 'none';
        requestListContainer.style.display = 'block'; 
        
        // Update the modal title to be generic
        document.querySelector('#requestModal h2').textContent = 'Pending Requests';

        if (data.requests && data.requests.length > 0) {
            data.requests.forEach(request => {
                const requestElement = document.createElement('div');
                requestElement.classList.add('request-item');
                
                // Add a badge/label for the request type
                const typeLabel = request.type === 'EXIT' ? 
                    '<span style="background-color: #00BFFF; color: black; padding: 2px 6px; border-radius: 3px; font-size: 12px; margin-right: 8px;">EXIT</span>' :
                    '<span style="background-color: #00BFFF; color: black; padding: 2px 6px; border-radius: 3px; font-size: 12px; margin-right: 8px;">ABSENT</span>';

                requestElement.innerHTML = `
                    <button class="name-btn">${typeLabel} ${request.firstname} ${request.surname}</button>
                `;
                requestElement.querySelector('.name-btn').addEventListener('click', () => showRequestDetails(request));
                requestListContainer.appendChild(requestElement);
            });
        } else {
            requestListContainer.innerHTML = '<p class="no-requests">🎉 No pending requests. All clear!</p>';
        }

    } catch (error) {
        console.error('Error fetching pending requests:', error);
        requestListContainer.innerHTML = '<p class="error-msg">Failed to load requests.</p>';
    }
}

/**
 * Displays the details of a selected request.
 * @param {object} request - The request object.
 */
function showRequestDetails(request) {
    currentRequestData = request; // Store the current request data

    // --- Conditional Display for Absent vs. Exit ---
    const isAbsent = request.type === 'ABSENT';
    
    // Update the detail header
    const detailHeader = document.querySelector('#requestDetailContainer h3');
    detailHeader.textContent = isAbsent ? 'Absent Request Details' : 'Exit Scholar Request Details';

    // Populate the detail view
    detailName.textContent = `${request.firstname} ${request.surname}`;
    detailReason.textContent = request.letter;
    
    const fellowshipDetailP = document.getElementById('detailFellowshipDate').parentNode;
    
    if (isAbsent) {
        // Show fellowship date for Absent Request
        const fellowshipDate = new Date(request.fellowship).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        document.getElementById('detailFellowshipDate').textContent = fellowshipDate;
        fellowshipDetailP.style.display = 'block';
    } else {
        // Hide fellowship date for Exit Request
        fellowshipDetailP.style.display = 'none';
    }

    // Switch view
    requestListContainer.style.display = 'none';
    requestDetailContainer.style.display = 'block';
}

/**
 * Handles the Accept or Reject decision for a request.
 * **UPDATED to handle ABSENT and EXIT types.**
 */
async function handleDecision(decision) {
    if (!currentRequestData) return;
    
    const type = currentRequestData.type;
    const actionText = type === 'EXIT' && decision === 'Approve' ? 'permanently exit' : decision.toLowerCase();
    
    if (!confirm(`Are you sure you want to ${actionText} the **${type}** request from ${currentRequestData.firstname} ${currentRequestData.surname}?`)) {
        return;
    }

    try {
        // *** UPDATED ENDPOINT ***
        const response = await fetch('/api/admin/process-request', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                requestId: currentRequestData.id,
                scholarId: currentRequestData.scholar_id,
                semId: currentRequestData.sem_id,
                decision: decision, 
                type: currentRequestData.type, // Pass the request type
                // Absent-specific fields (will be NULL for EXIT, which is fine)
                fellowshipId: currentRequestData.fellowship_id,
                // Email Context for Server-Side email
                scholarEmail: currentRequestData.email,
                scholarName: `${currentRequestData.firstname} ${currentRequestData.surname}`,
                reason: currentRequestData.letter
            })
        });

        const result = await response.json();

        if (response.ok) {
            alert(result.message);
            // After decision, go back to the list and refresh
            currentRequestData = null;
            await fetchPendingRequests();
        } else {
            alert(`Failed to process request: ${result.message || 'Server error.'}`);
            console.error('Decision error:', result);
        }

    } catch (error) {
        console.error(`Error processing request (${decision}):`, error);
        alert('An unexpected error occurred while processing the request.');
    }
}

//events handling
// ==============================================
// MAINPAGE SETTINGS MANAGEMENT (Switches)
// ==============================================

async function fetchMainpageSettings() {
    try {
        const response = await fetch('/api/admin/mainpage-settings');
        if (!response.ok) throw new Error('Failed to fetch settings');
        
        const settings = await response.json();
        
        const renewalSwitch = document.getElementById('renewalSwitch');
        const applicationSwitch = document.getElementById('applicationSwitch');
        const renewalStatusText = document.getElementById('renewalStatusText');
        const applicationStatusText = document.getElementById('applicationStatusText');

        // Set renewal status
        renewalSwitch.checked = settings.renewal_status === 'ON';
        renewalStatusText.textContent = settings.renewal_status;
        renewalStatusText.style.color = settings.renewal_status === 'ON' ? 'green' : 'red';

        // Set application status
        applicationSwitch.checked = settings.application_status === 'ON';
        applicationStatusText.textContent = settings.application_status;
        applicationStatusText.style.color = settings.application_status === 'ON' ? 'green' : 'red';

    } catch (error) {
        console.error('Error fetching mainpage settings:', error);
    }
}

async function updateStatus(type, status) {
    try {
        const response = await fetch('/api/admin/mainpage-settings/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type, status })
        });
        
        if (!response.ok) throw new Error(`Failed to update ${type} status.`);
        
        const result = await response.json();
        const statusTextElement = document.getElementById(`${type}StatusText`);
        statusTextElement.textContent = status;
        statusTextElement.style.color = status === 'ON' ? 'green' : 'red';

        alert(result.message);

    } catch (error) {
        console.error(`Error updating ${type} status:`, error);
        alert(`An error occurred while updating ${type} status.`);
        // Re-fetch to revert the switch state if the update failed
        fetchMainpageSettings(); 
    }
}

function updateRenewalStatus() {
    const status = this.checked ? 'ON' : 'OFF';
    updateStatus('renewal', status);
}

function updateApplicationStatus() {
    const status = this.checked ? 'ON' : 'OFF';
    updateStatus('application', status);
}

// ==============================================
// EVENT POSTING (CRUD)
// ==============================================

async function handleEventPost(e) {
    e.preventDefault();
    const form = e.target;
    const formData = new FormData(form);

    try {
        const response = await fetch('/api/admin/events/post', {
            method: 'POST',
            // No 'Content-Type' header needed, as FormData handles it
            body: formData
        });

        const result = await response.json();

        if (response.ok) {
            alert(result.message);
            closeCustomModal('modal-event-post');
            // Re-open and refresh the management modal
            await fetchEvents();
            openCustomModal('mp-manage-modal'); 
        } else {
            alert(`Failed to post event: ${result.message || 'Server error.'}`);
            console.error('Event Post error:', result);
        }

    } catch (error) {
        console.error('Error posting event:', error);
        alert('An unexpected error occurred while posting the event.');
    }
}

async function fetchEvents() {
    try {
        const response = await fetch('/api/admin/events');
        if (!response.ok) throw new Error('Failed to fetch events');
        
        const events = await response.json();
        const eventListBody = document.getElementById('eventListBody');
        eventListBody.innerHTML = ''; // Clear existing list

        const today = new Date().toISOString().split('T')[0];

        if (events.length === 0) {
            eventListBody.innerHTML = '<div style="padding: 10px; text-align: center;">No events posted yet.</div>';
            return;
        }

        events.forEach(event => {
            const eventDate = new Date(event.datestart).toISOString().split('T')[0];
            const isEventHeld = eventDate < today;
            const canSend = isEventHeld && event.recipient > 0;
            const sendButtonClass = canSend ? 'primary-action-btn' : 'secondary-action-btn';

            const row = document.createElement('div');
            row.className = 'event-row';
            row.innerHTML = `
                <div class="data-cell title-cell">${event.title_event}</div>
                <div class="data-cell date-cell">${eventDate}</div>
                <div class="data-cell link-cell"><a href="${event.link_event}" target="_blank">View</a></div>
                <div class="data-cell recipient-cell">${event.recipient}</div>
                <div class="data-cell price-cell">${event.price}</div>
                <div class="data-cell actions-cell">
                    <div class="event-actions">
                        <button class="action-btn send-btn ${sendButtonClass}" data-event-id="${event.id}" data-event-title="${event.title_event}" data-event-price="${event.price}" ${canSend ? '' : 'disabled'}>SEND</button>
                        <button class="action-btn delete-btn secondary-action-btn" onclick="deleteEvent(${event.id})">DELETE</button>
                    </div>
                </div>
            `;
            eventListBody.appendChild(row);
        });

        // Add event listeners for Send buttons
        document.querySelectorAll('.send-btn').forEach(button => {
            if (!button.disabled) {
                button.addEventListener('click', handleSendPriceModal);
            }
        });

    } catch (error) {
        console.error('Error fetching events:', error);
        document.getElementById('eventListBody').innerHTML = '<div style="padding: 10px; color: red; text-align: center;">Failed to load events.</div>';
    }
}

async function deleteEvent(eventId) {
    if (!confirm('Are you sure you want to delete this event? This action cannot be undone.')) {
        return;
    }

    try {
        const response = await fetch(`/api/admin/events/${eventId}`, {
            method: 'DELETE'
        });

        const result = await response.json();

        if (response.ok) {
            alert(result.message);
            fetchEvents(); // Refresh the list
        } else {
            alert(`Failed to delete event: ${result.message || 'Server error.'}`);
        }
    } catch (error) {
        console.error('Error deleting event:', error);
        alert('An unexpected error occurred while deleting the event.');
    }
}

// ==============================================
// SEND PRICE MODAL (Scholar Search & Apply)
// ==============================================

let selectedEventId = null;
let selectedEventPrice = null;

function handleSendPriceModal(e) {
    selectedEventId = e.target.getAttribute('data-event-id');
    selectedEventPrice = e.target.getAttribute('data-event-price');
    const eventTitle = e.target.getAttribute('data-event-title');
    
    // Set modal text
    document.getElementById('sendPriceEventTitle').textContent = eventTitle;
    document.getElementById('sendPriceEventHours').textContent = selectedEventPrice;
    document.getElementById('currentEventId').value = selectedEventId;

    // Reset form and results
    document.getElementById('sendPriceForm').reset();
    document.getElementById('scholarSearchResults').innerHTML = '';

    openCustomModal('modal-send-price');
}

async function searchScholarForPrice() {
    const scholarName = document.getElementById('scholarNameSearch').value.trim();
    const resultsContainer = document.getElementById('scholarSearchResults');
    resultsContainer.innerHTML = ''; // Clear previous results
    
    if (!scholarName) {
        resultsContainer.innerHTML = '<div style="padding: 10px; color: #555;">Please enter a scholar name.</div>';
        return;
    }

    try {
        const response = await fetch(`/api/admin/scholar/search-for-price?name=${encodeURIComponent(scholarName)}&eventId=${selectedEventId}`);
        if (!response.ok) throw new Error('Failed to search scholars');
        
        const scholars = await response.json();

        if (scholars.length === 0) {
            resultsContainer.innerHTML = '<div style="padding: 10px; color: red;">No scholars found or scholar has already received the price for this event.</div>';
            return;
        }

        scholars.forEach(scholar => {
            const row = document.createElement('div');
            row.className = 'search-result-row';
            row.innerHTML = `
                <span>${scholar.surname}, ${scholar.firstname} (${scholar.email})</span>
                <button class="action-btn primary-action-btn" onclick="applyPriceToScholar(${scholar.scholar_id}, ${selectedEventId}, ${selectedEventPrice}, '${scholar.firstname} ${scholar.surname}', '${scholar.email}')">Apply Price</button>
            `;
            resultsContainer.appendChild(row);
        });

    } catch (error) {
        console.error('Error searching scholar:', error);
        resultsContainer.innerHTML = '<div style="padding: 10px; color: red;">An error occurred during search.</div>';
    }
}

async function applyPriceToScholar(scholarId, eventId, price, fullName, email) {
    if (!confirm(`Are you sure you want to award ${price} hours to ${fullName} for this event?`)) {
        return;
    }

    try {
        const response = await fetch('/api/admin/events/apply-price', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ scholarId, eventId, price, fullName, email })
        });

        const result = await response.json();

        if (response.ok) {
            alert(result.message);
            closeCustomModal('modal-send-price');
            // Refresh the event list in the background
            fetchEvents();
        } else {
            alert(`Failed to apply price: ${result.message || 'Server error.'}`);
            console.error('Apply Price error:', result);
        }

    } catch (error) {
        console.error('Error applying price:', error);
        alert('An unexpected error occurred while applying the price.');
    }
}

//signature upload
// Get the modal, button, and close elements
const certModal = document.getElementById('Modal-cert');
const certBtn = document.getElementById('certBtn');
const certCloseBtn = document.getElementsByClassName('close-signature')[0];
const signatureUploadForm = document.getElementById('signatureUploadForm');

// When the user clicks the "Certificate" button, open the modal
certBtn.onclick = function() {
    certModal.style.display = 'block';
}

// When the user clicks on <span> (x), close the modal
certCloseBtn.onclick = function() {
    certModal.style.display = 'none';
    signatureUploadForm.reset(); // Clear the form on close
}

// When the user clicks anywhere outside of the modal, close it
window.addEventListener('click', (event) => {
    if (event.target == certModal) {
        certModal.style.display = 'none';
        signatureUploadForm.reset();
    }
});

// Custom validation for full name (only letters and spaces)
const fullNameInput = document.getElementById('fullNameInput');
fullNameInput.addEventListener('input', function() {
    // Regex to allow only letters and spaces
    this.value = this.value.replace(/[^A-Za-z\s]/g, '');
});

// Handle Signature Form Submission
signatureUploadForm.addEventListener('submit', async function(e) {
    e.preventDefault();

    // Basic client-side validation
    if (fullNameInput.value.trim() === '') {
        alert('Please enter your full name.');
        return;
    }
    const signatureFile = document.getElementById('signatureFileInput').files[0];
    if (!signatureFile) {
        alert('Please upload a signature file.');
        return;
    }

    const formData = new FormData(this); // Collects fullname and signature file

    try {
        const response = await fetch('/upload-signature', {
            method: 'POST',
            body: formData,
            // 'Content-Type' is automatically set by the browser for FormData with file uploads
        });

        const result = await response.json();

        if (result.success) {
            alert('✅ Signature saved successfully!');
            certModal.style.display = 'none';
            this.reset();
        } else {
            alert(`❌ Error saving signature: ${result.message}`);
        }
    } catch (error) {
        console.error('Submission error:', error);
        alert('An unexpected error occurred during submission.');
    }
});