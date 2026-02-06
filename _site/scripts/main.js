document.addEventListener('DOMContentLoaded', () => {
    // Set dynamic year in footer
    const yearSpan = document.getElementById('footer-year');
    if (yearSpan) {
      yearSpan.textContent = new Date().getFullYear();
    }
    // Mobile menu toggle
    const hamburger = document.getElementById('hamburger');
    const navMenu = document.getElementById('nav-menu');
    
    if (hamburger && navMenu) {
      hamburger.addEventListener('click', () => {
        navMenu.classList.toggle('active');
        
        // Animate hamburger
        const spans = hamburger.querySelectorAll('span');
        spans.forEach(span => {
          span.classList.toggle('active');
        });
      });
    }
    
    // Close mobile menu when clicking outside
    document.addEventListener('click', (e) => {
      if (navMenu && navMenu.classList.contains('active') && 
          !navMenu.contains(e.target) && 
          !hamburger.contains(e.target)) {
        navMenu.classList.remove('active');
        
        // Reset hamburger
        const spans = hamburger.querySelectorAll('span');
        spans.forEach(span => {
          span.classList.remove('active');
        });
      }
    });
    
    // Mobile dropdown toggle
    const dropdownToggles = document.querySelectorAll('.dropdown-toggle');
    
    dropdownToggles.forEach(toggle => {
      toggle.addEventListener('click', (e) => {
        // Only handle clicks in mobile view
        if (window.innerWidth <= 768) {
          e.preventDefault();
          const dropdown = toggle.parentElement;
          dropdown.classList.toggle('active');
        }
      });
    });
    
    // Add active class to current nav item based on URL
    const currentLocation = window.location.pathname;
    const navLinks = document.querySelectorAll('#nav-menu a');
    const pageName = currentLocation.split('/').pop();
    
    navLinks.forEach(link => {
      const linkHref = link.getAttribute('href');
      
      if (linkHref === pageName) {
        link.classList.add('active');
        
        // If in dropdown, also make parent active
        const parentLi = link.closest('li.dropdown');
        if (parentLi) {
          const parentLink = parentLi.querySelector('.dropdown-toggle');
          if (parentLink) {
            parentLink.classList.add('active');
          }
        }
      }
    });
    
    // Smooth scrolling for anchor links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
      anchor.addEventListener('click', function (e) {
        const href = this.getAttribute('href');
        
        if (href !== '#' && href !== '') {
          e.preventDefault();
          
          const target = document.querySelector(href);
          if (target) {
            target.scrollIntoView({
              behavior: 'smooth'
            });
          }
        }
      });
    });
    
    // Animation on scroll (simple implementation)
    const animateElements = document.querySelectorAll('.animate-on-scroll');
    
    function checkIfInView() {
      animateElements.forEach(element => {
        const elementTop = element.getBoundingClientRect().top;
        const elementVisible = 150;
        
        if (elementTop < window.innerHeight - elementVisible) {
          element.classList.add('visible');
        }
      });
    }
    
    // Initial check
    checkIfInView();
    
    // Check on scroll
    window.addEventListener('scroll', checkIfInView);
  });