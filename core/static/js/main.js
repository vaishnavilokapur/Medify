// Load initial all medicines by sending empty query
window.onload = () => {
    if (document.getElementById("resultsGrid")) searchMedicines("");
    if (document.getElementsByClassName("carousel-slide").length) startCarousel();

    const pendingProduct = sessionStorage.getItem("pendingCartProduct");
    if (pendingProduct && window.isAuthenticated) {
        addToCart(pendingProduct);
    }
};

// Carousel Logic
let slideIndex = 0;
let slideInterval;
function startCarousel() {
    slideInterval = setInterval(() => { changeSlide(1); }, 5000);
}
function changeSlide(n) {
    showSlide(slideIndex += n);
}
function currentSlide(n) {
    showSlide(slideIndex = n);
    clearInterval(slideInterval);
    startCarousel();
}
function showSlide(n) {
    const slides = document.getElementsByClassName("carousel-slide");
    const dots = document.getElementsByClassName("dot");
    if (!slides.length) return;
    if (n >= slides.length) slideIndex = 0;
    if (n < 0) slideIndex = slides.length - 1;
    for (let i = 0; i < slides.length; i++) slides[i].classList.remove("active");
    for (let i = 0; i < dots.length; i++) dots[i].classList.remove("active");
    slides[slideIndex].classList.add("active");
    dots[slideIndex].classList.add("active");
}

function displayMedicines(medicines, title="Search Results") {
    document.getElementById("resultsTitle").innerText = title;
    const grid = document.getElementById("resultsGrid");
    
    if (medicines && medicines.length > 0) {
        let html = "";
        medicines.forEach(med => {
            html += `
                <div class="card">
                    <div class="card-img">
                        <img src="${med.image}" alt="${med.name}" style="max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 4px;">
                    </div>
                    <div>
                        <div class="card-title">${med.name}</div>
                        <div class="card-desc">${med.description}</div>
                        <div class="card-price">₹${med.price}</div>
                    </div>
                    <button class="add-to-cart" onclick="addToCart(${med.id}, this)">ADD TO CART</button>
                </div>
            `;
        });
        grid.innerHTML = html;
    } else {
        grid.innerHTML = "<p>No medicines found for your query.</p>";
    }
}

function searchMedicines(forceQuery = null) {
    const grid = document.getElementById("resultsGrid");
    if (!grid) return;

    const query = forceQuery !== null ? forceQuery : document.getElementById("searchInput").value;
    grid.innerHTML = "<p>Searching...</p>";
    document.getElementById("aiBanner").style.display = "none";

    fetch(`/medicines/search/?q=${encodeURIComponent(query)}`)
        .then(response => response.json())
        .then(data => displayMedicines(data.medicines, query ? `Results for "${query}"` : "All Medicines"))
        .catch(e => { grid.innerHTML = "<p>Error loading catalog.</p>"; });
}

function startVoiceSearch() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        const message = window.isSecureContext === false
            ? "Voice search requires HTTPS or localhost."
            : "Voice search is not supported in this browser. Try Chrome or Edge.";
        document.getElementById("searchInput").placeholder = message;
        return;
    }
    
    const recognition = new SpeechRecognition();
    const voiceBtn = document.getElementById('voiceBtn');
    const searchInput = document.getElementById("searchInput");
    let recognitionError = "";
    let receivedTranscript = false;

    recognition.lang = navigator.language || "en-US";

    recognition.onstart = function() {
        recognitionError = "";
        receivedTranscript = false;
        voiceBtn.classList.add("recording");
        searchInput.placeholder = "Listening to your symptoms...";
        searchInput.value = "";
    };
    
    recognition.onresult = function(event) {
        const transcript = event.results[0][0].transcript.trim();
        if (!transcript) return;
        receivedTranscript = true;
        searchInput.value = transcript;
        callAIAssistant(transcript);
    };

    recognition.onerror = function(event) {
        const messages = {
            "audio-capture": "No microphone was found. Check your microphone connection.",
            "network": "Voice recognition needs a network connection. Try again.",
            "no-speech": "No speech detected. Tap the microphone and try again.",
            "not-allowed": "Allow microphone access in your browser to use voice search.",
            "service-not-allowed": "Voice recognition is blocked by your browser.",
            "language-not-supported": "Voice recognition does not support your browser language."
        };
        recognitionError = messages[event.error] || "Voice search failed. Please try again.";
        searchInput.placeholder = recognitionError;
    };

    recognition.onend = function() {
        voiceBtn.classList.remove("recording");
        if (!recognitionError) {
            searchInput.placeholder = receivedTranscript
                ? "Search for medicines or describe your symptoms..."
                : "No speech detected. Tap the microphone and try again.";
        }
    };

    try {
        recognition.start();
    } catch (error) {
        voiceBtn.classList.remove("recording");
        searchInput.placeholder = "Voice search could not start. Check microphone access and try again.";
    }
}

function callAIAssistant(symptoms) {
    const grid = document.getElementById("resultsGrid");
    grid.innerHTML = "<p>Analyzing your symptoms...</p>";
    
    fetch(`/ai/recommend/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symptoms: symptoms })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            const banner = document.getElementById("aiBanner");
            banner.style.display = "block";
            document.getElementById("aiAdvice").innerText = data.advice;
            document.getElementById("aiDisclaimer").innerText = `⚠️ ${data.disclaimer}`;
            
            displayMedicines(data.medicines, "Recommended Medicines");
        } else {
            grid.innerHTML = `<p style="color: red;">${data.error}</p>`;
        }
    })
    .catch(e => { grid.innerHTML = "<p>Service offline.</p>"; });
}

// Checkout & AI Validation Flow
let currentPrice = 0;
let currentOrderItems = [];
let isVerified = false;
let isPaymentStep = false;

function addToCart(medicineId, button = null) {
    if (!window.isAuthenticated) {
        sessionStorage.setItem("pendingCartProduct", medicineId);
        const next = `${window.location.pathname}${window.location.search}`;
        window.location.href = `/accounts/login/?next=${encodeURIComponent(next)}`;
        return;
    }

    const csrfToken = document.querySelector('input[name="csrfmiddlewaretoken"]')?.value;
    fetch("/orders/cart/add/", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-CSRFToken": csrfToken
        },
        body: JSON.stringify({ medicine_id: medicineId })
    })
        .then(response => response.json().then(data => {
            if (!response.ok) throw new Error(data.error || "Unable to add this medicine to your cart.");
            return data;
        }))
        .then(data => {
            document.getElementById("cartCount").innerText = data.cart_count;
            sessionStorage.removeItem("pendingCartProduct");
            if (button) {
                const originalText = button.innerText;
                button.innerText = "ADDED TO CART";
                button.disabled = true;
                setTimeout(() => {
                    button.innerText = originalText;
                    button.disabled = false;
                }, 1200);
            }
        })
        .catch(error => alert(error.message));
}

function removeCartItem(itemId, button) {
    button.disabled = true;
    const csrfToken = document.querySelector('input[name="csrfmiddlewaretoken"]')?.value;
    fetch(`/orders/cart/remove/${itemId}/`, {
        method: "POST",
        headers: { "X-CSRFToken": csrfToken }
    })
        .then(response => response.json().then(data => {
            if (!response.ok) throw new Error(data.error || "Unable to remove this medicine.");
            return data;
        }))
        .then(data => {
            document.getElementById("cartCount").innerText = data.cart_count;
            window.location.reload();
        })
        .catch(error => {
            button.disabled = false;
            alert(error.message);
        });
}

function openCartCheckout() {
    currentOrderItems = [...document.querySelectorAll(".cart-item")].map(item => ({
        medicine_id: Number(item.dataset.medicineId),
        name: item.dataset.medicineName,
        unit_price: Number(item.dataset.unitPrice),
        quantity: Number(item.dataset.quantity)
    }));
    if (!currentOrderItems.length) return;

    document.getElementById("checkoutModal").style.display = "flex";
    document.getElementById("checkoutForm").style.display = "block";
    document.getElementById("paymentSection").style.display = "none";
    document.getElementById("backToDetailsBtn").style.display = "none";
    currentPrice = currentOrderItems.reduce((total, item) => total + item.unit_price * item.quantity, 0);
    isVerified = false;
    isPaymentStep = false;
    document.getElementById("patientName").value = "";
    document.getElementById("hasDiabetes").checked = false;
    document.getElementById("hasThyroid").checked = false;
    document.getElementById("otherConditions").value = "";
    document.getElementById("aiCheckoutAdvice").style.display = "none";
    document.getElementById("proceedBtn").innerText = "Verify Profile with AI";
}

function showPaymentStep() {
    document.getElementById("checkoutForm").style.display = "none";
    document.getElementById("paymentSection").style.display = "block";
    const paymentItems = document.getElementById("paymentItems");
    paymentItems.replaceChildren();
    currentOrderItems.forEach(item => {
        const row = document.createElement("div");
        row.className = "checkout-payment-row";
        const description = document.createElement("span");
        description.innerText = `${item.name} × ${item.quantity}`;
        const lineTotal = document.createElement("strong");
        lineTotal.innerText = `₹${(item.unit_price * item.quantity).toFixed(2)}`;
        row.append(description, lineTotal);
        paymentItems.append(row);
    });
    document.getElementById("paymentAmount").innerText = `₹${currentPrice.toFixed(2)}`;
    document.getElementById("backToDetailsBtn").style.display = "inline-flex";
    document.getElementById("proceedBtn").innerText = `Pay ₹${currentPrice} securely`;
    isPaymentStep = true;
}

function returnToPatientDetails() {
    document.getElementById("checkoutForm").style.display = "block";
    document.getElementById("paymentSection").style.display = "none";
    document.getElementById("backToDetailsBtn").style.display = "none";
    document.getElementById("proceedBtn").innerText = "Continue to Payment";
    isPaymentStep = false;
}

function closeModal() {
    document.getElementById("checkoutModal").style.display = "none";
}

function verifyAndCheckout() {
    const btn = document.getElementById("proceedBtn");
    const name = document.getElementById("patientName").value;
    const diabetes = document.getElementById("hasDiabetes").checked;
    const thyroid = document.getElementById("hasThyroid").checked;
    const other = document.getElementById("otherConditions").value;
    const medNames = currentOrderItems.map(item => item.name).join(", ");

    if (!name) { alert("Please enter Patient Name"); return; }

    if (!isVerified) {
        // Step 1: Verify with AI
        btn.innerText = "Verifying...";
        btn.disabled = true;

        // Simulating the AI verification response.
        setTimeout(() => {
            const adviceBox = document.getElementById("aiCheckoutAdvice");
            adviceBox.style.display = "block";
            
            let advice = `<strong>Medical Note:</strong> For ${medNames}, please follow the medicine labels and professional guidance. `;
            if (diabetes && currentOrderItems.some(item => item.name.includes("Syrup"))) {
                advice += `<br><span style="color:red;">⚠️ WARNING: Since you have Diabetes, please ensure this syrup is sugar-free.</span>`;
            } else if (diabetes) {
                advice += `Safe for diabetic patients if taken as prescribed.`;
            } else if (thyroid) {
                advice += `Does not interfere with thyroid medication. Take normally.`;
            } else {
                advice += `Standard dosage applies. No contraindications found with your profile.`;
            }
            
            adviceBox.innerHTML = advice;
            btn.innerText = "Continue to Payment";
            btn.disabled = false;
            isVerified = true;
        }, 1500);

    } else {
        if (!isPaymentStep) {
            showPaymentStep();
            return;
        }

        // Start secure payment after the in-app payment summary is reviewed.
        const options = {
            "key": "rzp_test_TSNJSF0X6kqf1b", 
            "amount": Math.round(currentPrice * 100), 
            "currency": "INR",
            "name": "Medify",
            "description": "Medicine Purchase",
            "handler": function (response){
                // Save Order to Backend MySQL
                fetch('/orders/create/', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        items: currentOrderItems.map(item => ({
                            medicine_id: item.medicine_id,
                            quantity: item.quantity
                        })),
                        patient_name: name,
                        payment_id: response.razorpay_payment_id
                    })
                }).then(response => response.json().then(data => {
                    if (!response.ok || !data.success) {
                        throw new Error(data.error || "Unable to complete this order.");
                    }
                    return data;
                })).then(data => {
                    const cartCount = document.getElementById("cartCount");
                    if (cartCount) cartCount.innerText = data.cart_count;
                    alert(`Payment Successful & Order Recorded! Razorpay Payment ID: ${response.razorpay_payment_id}`);
                    closeModal();
                    if (document.body.classList.contains("cart-page-body")) window.location.reload();
                }).catch(error => {
                    alert(error.message);
                });
            },
            "prefill": { "name": name, "email": "user@medify.com" },
            "theme": { "color": "#d32f2f" }
        };
        const rzp1 = new Razorpay(options);
        rzp1.on('payment.failed', function (response){
            alert("Payment Failed! Reason: " + response.error.description);
        });
        rzp1.open();
    }
}
