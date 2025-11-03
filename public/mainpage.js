/**
 * Function to display a dynamic greeting based on the current time.
 */

let currentSlideIndex = 0;
let eventsData = [];

function displayGreeting() {
    const greetingElement = document.getElementById('greeting');
    const hours = new Date().getHours();
    let greeting = 'Good Day!';

    if (hours < 12) {
        greeting = 'Good Morning!';
    } else if (hours < 18) {
        greeting = 'Good Afternoon!';
    } else {
        greeting = 'Good Evening!';
    }

    greetingElement.textContent = greeting;
}

/**
 * Function to set the 'active' class on the navigation link that corresponds
 * to the currently visible section on the screen.
 */
function setActiveNavLinkOnScroll() {
    const sections = document.querySelectorAll('section');
    const navLinks = document.querySelectorAll('.nav-link');
    const navHeight = document.querySelector('.navbar').offsetHeight;

    // The threshold is set a bit below the top of the viewport to account for the fixed header
    const scrollThreshold = window.scrollY + navHeight + 10;

    sections.forEach(section => {
        const sectionTop = section.offsetTop;
        const sectionBottom = sectionTop + section.offsetHeight;
        const sectionId = section.getAttribute('id');

        if (scrollThreshold >= sectionTop && scrollThreshold < sectionBottom) {
            navLinks.forEach(link => {
                link.classList.remove('active');
                if (link.getAttribute('href').substring(1) === sectionId) {
                    link.classList.add('active');
                }
            });
        }
    });
}

/**
 * Function to handle smooth scrolling when a navigation link is clicked.
 */
function handleNavClick() {
    const navLinks = document.querySelectorAll('.nav-link');
    const navHeight = document.querySelector('.navbar').offsetHeight;

    navLinks.forEach(link => {
        link.addEventListener('click', function(e) {
            e.preventDefault();

            // Remove active class from all links
            navLinks.forEach(l => l.classList.remove('active'));

            // Add active class to the clicked link
            this.classList.add('active');

            const targetId = this.getAttribute('href');
            const targetElement = document.querySelector(targetId);

            if (targetElement) {
                // Calculate the position to scroll to (element top - navbar height)
                const targetPosition = targetElement.offsetTop - navHeight;

                window.scrollTo({
                    top: targetPosition,
                    behavior: 'smooth'
                });
            }
        });
    });
}

/**
 * NEW FUNCTION: Fetches the current application and renewal status from the server
 * and enables/disables the respective buttons.
 */
async function manageAccessButtons() {
    try {
        // ⭐ CRITICAL CHANGE: Use the new public endpoint
        const response = await fetch('/api/public/mainpage-status'); 
        if (!response.ok) throw new Error('Failed to fetch mainpage settings');

        const settings = await response.json();
        const applicationStatus = settings.application_status;
        const renewalStatus = settings.renewal_status;
        
        const applicationButtons = document.querySelectorAll('.application-button');
        const renewalButtons = document.querySelectorAll('.renewal-button');
        const disabledClass = 'disabled-link';

        // Apply/Remove disabled class based on status
        [
            { status: applicationStatus, buttons: applicationButtons },
            { status: renewalStatus, buttons: renewalButtons }
        ].forEach(({ status, buttons }) => {
            const action = status !== 'ON' ? 'add' : 'remove';
            buttons.forEach(button => button.classList[action](disabledClass));
        });

    } catch (error) {
        console.error('Error managing mainpage buttons:', error);
        // Fallback to disabling all if fetch fails
        document.querySelectorAll('.application-button, .renewal-button').forEach(button => {
             button.classList.add('disabled-link');
        });
    }
}
function setupEventsSlider() {
    const wrapper = document.querySelector('.slides-wrapper');
    const viewPostBtn = document.querySelector('.view-post-btn');
    const prevBtn = document.querySelector('.prev-btn');
    const nextBtn = document.querySelector('.next-btn');
    const dotsContainer = document.querySelector('.slide-dots');

    // ------------------------------------------
    // 1. Core Slider Function: Updates display
    // ------------------------------------------
    function updateSlider() {
        if (eventsData.length === 0) return;

        // Slide the wrapper to the current event
        const offset = -currentSlideIndex * (100 / eventsData.length);
        wrapper.style.transform = `translateX(${offset}%)`;

        // Update the View Post button link
        const currentEvent = eventsData[currentSlideIndex];
        if (currentEvent.link_event) {
            viewPostBtn.href = currentEvent.link_event;
            viewPostBtn.style.display = 'inline-block';
        } else {
            viewPostBtn.href = '#';
            viewPostBtn.style.display = 'none';
        }

        // Update dot activity
        dotsContainer.querySelectorAll('.dot').forEach((dot, index) => {
            dot.classList.toggle('active', index === currentSlideIndex);
        });

        // Update arrow visibility (optional)
        prevBtn.disabled = currentSlideIndex === 0;
        nextBtn.disabled = currentSlideIndex === eventsData.length - 1;
    }

    // ------------------------------------------
    // 2. Navigation Handlers
    // ------------------------------------------
    function goToSlide(index) {
        if (index >= 0 && index < eventsData.length) {
            currentSlideIndex = index;
            updateSlider();
        }
    }

    nextBtn.addEventListener('click', () => goToSlide(currentSlideIndex + 1));
    prevBtn.addEventListener('click', () => goToSlide(currentSlideIndex - 1));

    // ------------------------------------------
    // 3. Dot Generation and Interaction
    // ------------------------------------------
    dotsContainer.innerHTML = '';
    eventsData.forEach((_, index) => {
        const dot = document.createElement('span');
        dot.classList.add('dot');
        dot.addEventListener('click', () => goToSlide(index));
        dotsContainer.appendChild(dot);
    });

    // Initialize the slider to the first event
    updateSlider();
}
async function displayActiveEvents() {
    const wrapper = document.querySelector('.slides-wrapper');
    const viewPostBtn = document.querySelector('.view-post-btn');
    const updatesContainer = document.querySelector('.updates-container');

    try {
        const response = await fetch('/api/public/active-events');
        if (!response.ok) throw new Error('Failed to fetch events.');

        eventsData = await response.json(); // Store data globally

        wrapper.innerHTML = '';
        if (eventsData && eventsData.length > 0) {
            // Adjust wrapper width dynamically based on the number of events
            wrapper.style.width = `${eventsData.length * 100}%`;
            
            eventsData.forEach(event => {
                const slide = document.createElement('div');
                slide.classList.add('event-slide');
                
                // ⭐ CRITICAL FIX: Set the slide width dynamically
                slide.style.width = `${100 / eventsData.length}%`; 

                if (event.pic_event) {
                    const img = document.createElement('img');
                    img.src = event.pic_event;
                    img.alt = 'Event Poster';
                    img.classList.add('event-image');
                    slide.appendChild(img);
                } else {
                     // Placeholder text if no image is available
                     slide.innerHTML = '<p>No image available for this event.</p>';
                }
                wrapper.appendChild(slide);
            });

            // Set up the slider navigation now that slides are built
            setupEventsSlider();

        } else {
            // Handle no events case
            updatesContainer.querySelector('.event-slider').innerHTML = 
                '<div class="event-slide" style="width:100%;"><p>No new active events for the current semester.</p></div>';
            viewPostBtn.style.display = 'none';
        }

    } catch (error) {
        console.error('Error displaying active events:', error);
        updatesContainer.querySelector('.event-slider').innerHTML = 
            '<div class="event-slide" style="width:100%;"><p>Could not load events.</p></div>';
        viewPostBtn.style.display = 'none';
    }
}

// --- Initialize when the DOM is fully loaded ---
document.addEventListener('DOMContentLoaded', () => {
    // 1. Set the dynamic greeting
    displayGreeting();

    // 2. Set up smooth scrolling for navigation links
    handleNavClick();

    // 3. Set up active link adjustment on scroll
    setActiveNavLinkOnScroll();
    window.addEventListener('scroll', setActiveNavLinkOnScroll);
    
    // 4. NEW: Manage button accessibility based on admin settings
    manageAccessButtons();

    // ⭐ NEW: Fetch and display active events
    displayActiveEvents();
});