// State variables
let modal = null;
let openModalBtn = null;
let closeModalBtn = null;
let checkBtn = null;
let currentUser = null;
let employeeFormData = null;

// Timer variables
let timerInterval = null;
let timerStartTime = null;
let pausedTime = 0; // milliseconds
let timerDate = null; // stores the date (yyyy-mm-dd) when timer was last started or resumed

// On page load, reset timer if it's a new day
document.addEventListener("DOMContentLoaded", function () {
  const today = getTodayString();
  if (timerDate !== today) {
    pausedTime = 0;
    timerDate = today;
    resetTimerDisplay();
  }
});

document.addEventListener("DOMContentLoaded", async function () {
  // Get DOM elements
  modal = document.getElementById("myModal");
  openModalBtn = document.getElementById("openModalBtn");
  closeModalBtn = document.getElementById("closeModalBtn");
  checkBtn = document.getElementById("checkBtn");

  // Check if elements exist
  if (!modal || !checkBtn) {
    console.error("Required DOM elements not found");
    return;
  }

  // Setup modal behavior
  modal.style.display = "block";

  if (openModalBtn) {
    openModalBtn.onclick = function () {
      modal.style.display = "block";
    };
  }

  if (closeModalBtn) {
    closeModalBtn.onclick = function () {
      modal.style.display = "none";
    };
  }

  window.onclick = function (event) {
    if (event.target == modal) {
      modal.style.display = "none";
    }
  };

  // Initialize Zoho
  const test = await ZOHO.embeddedApp.init();
  console.log("testing", test);
  console.log("zoho", ZOHO);
  currentUser = await ZOHO.People.API.getCurrUserInfo();
  let currentUserFormDetails = await ZOHO.People.API.getFormComponents({
    formName: "P_Employee",
  });
  console.log("user data", currentUser);
  console.log("form components", currentUserFormDetails);

  // Update UI
  updateName(currentUser.fname, currentUser.lname);
  initializeStatusPill();
  let checkWFHCredits = await getEmployeeFormData();
  if (Number(checkWFHCredits.Number_of_available_Work_From_Home) == 0) {
    checkBtn.style.display = "none";
    let creditsExhaustedElement = document.querySelector(".credits-exhausted");
    creditsExhaustedElement.style.display = "inline-block";
  }
  // Setup check button handler
  checkBtn.onclick = async function () {
    employeeFormData = await getEmployeeFormData();
    if (Number(employeeFormData.Number_of_available_Work_From_Home) < 1) {
      return;
    }
    let timerDisplay = document.getElementById("timerDisplay");
    // If timerDate is not today, reset everything
    const today = getTodayString();
    if (timerDate !== today) {
      pausedTime = 0;
      timerDate = today;
      resetTimerDisplay();
    }

    if (checkBtn.textContent === "Check In") {
      // Check user location before allowing check in
      const locationAllowed = await checkUserLocation();
      console.log(locationAllowed);
      if (locationAllowed === true) {
        // Resume or start timer
        startOrResumeTimer();
        checkBtn.textContent = "Check Out";
        setStatus("Office-In", "status-office");
        // Store check-in time
        await updateCheckInAttendance();
      } else {
        // Only decrement WFH credits once per user per day
        if (!hasWFHCreditCheckedToday()) {
          await checkWorkFromHomeCredits();
          markWFHCreditCheckedToday();
        }
        // Allow remote-in but indicate status
        startOrResumeTimer();
        checkBtn.textContent = "Check Out";
        setStatus("Remote-In", "status-remote");
        // Store check-in time
        await updateCheckInAttendance();
      }
      // await updateCheckInAttendance();
    } else {
      // Pause timer
      pauseTimer();
      checkBtn.textContent = "Check In";
      // Store check-out time
      await updateCheckOutAttendance();
      // Do not reset timer display, just leave it at paused value
      if (timerDisplay) {
        timerDisplay.textContent = formatTime(pausedTime);
      }
      // Revert to default or weekend status
      const day = new Date().getDay();
      if (day === 0 || day === 6) {
        setStatus("Weekend", "status-weekend");
      } else {
        setStatus("Out", "status-checkedout");
      }
    }
  };
});

function updateName(firstName, lastName) {
  // Find the modal content div
  let modalContent = document.querySelector("#myModal .modal-content");
  if (!modalContent) return;

  // Remove any existing welcome header to avoid duplicates
  let existingHeader = modalContent.querySelector(".welcome-header");
  if (existingHeader) {
    existingHeader.remove();
  }

  // Create a new header element
  let welcomeText = document.querySelector(".welcome-text");
  welcomeText.className = "welcome-header";
  welcomeText.textContent = `Welcome ${firstName} ${lastName}`;

  // Insert the header at the top of the modal content
  // modalContent.insertBefore(header, modalContent.firstChild);
}

function initializeStatusPill() {
  let statusText = document.getElementById("statusText");
  if (!statusText) return;
  const day = new Date().getDay(); // 0 Sun, 6 Sat
  // Weekend
  if (day === 0 || day === 6) {
    setStatus("Weekend", "status-weekend");
  } else {
    setStatus("Yet to check in", "status-default");
  }
}

function setStatus(label, cls) {
  let statusText = document.getElementById("statusText");
  if (!statusText) return;
  statusText.textContent = label;
  statusText.className = ""; // reset
  statusText.id = "statusText"; // preserve id
  statusText.classList.add(cls);
}

function formatTime(durationMs) {
  let totalSeconds = Math.floor(durationMs / 1000);
  let hours = Math.floor(totalSeconds / 3600);
  let minutes = Math.floor((totalSeconds % 3600) / 60);
  let seconds = totalSeconds % 60;
  return (
    String(hours).padStart(2, "0") +
    ":" +
    String(minutes).padStart(2, "0") +
    ":" +
    String(seconds).padStart(2, "0")
  );
}

function getTodayString() {
  const now = new Date();
  return (
    now.getFullYear() +
    "-" +
    String(now.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(now.getDate()).padStart(2, "0")
  );
}

// Track if WFH credits were checked for the user today
function getWFHCreditKey() {
  const userId =
    currentUser && currentUser.usererec ? currentUser.usererec : "unknown";
  return `wfhCreditChecked:${userId}:${getTodayString()}`;
}

function hasWFHCreditCheckedToday() {
  try {
    return localStorage.getItem(getWFHCreditKey()) === "1";
  } catch (e) {
    console.warn("localStorage unavailable; defaulting to re-check", e);
    return false;
  }
}

function markWFHCreditCheckedToday() {
  try {
    localStorage.setItem(getWFHCreditKey(), "1");
  } catch (e) {
    console.warn("localStorage unavailable; cannot persist WFH check flag", e);
  }
}

// Format date and time as dd-MMM-yyyy HH:mm:ss (24-hour format)
function formatDateTime(date) {
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];

  const day = String(date.getDate()).padStart(2, "0");
  const month = months[date.getMonth()];
  const year = date.getFullYear();

  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");

  return `${day}-${month}-${year} ${hours}:${minutes}:${seconds}`;
}

// Get localStorage key for check times
function getCheckTimeKey(type) {
  const userId =
    currentUser && currentUser.usererec ? currentUser.usererec : "unknown";
  const today = getTodayString();
  return `checkTime:${type}:${userId}:${today}`;
}

// Store check-in time
async function updateCheckInAttendance() {
  try {
    const checkInTime = formatDateTime(new Date());
    let reqData = {
      url: "https://people.zoho.in/people/api/attendance",
      connectiondetails: "workfromhome",
      method: "POST",
      apiParams: {
        checkIn: checkInTime,
        empId: currentUser.empid,
      },
    };
    const data = await ZOHO.People.API.invokeUrl(reqData);
    console.log("api response of checkIn", data);
    // localStorage.setItem(getCheckTimeKey("checkIn"), checkInTime);
    console.log("Check-in time stored:", checkInTime);
  } catch (e) {
    console.warn("localStorage unavailable; cannot store check-in time", e);
  }
}

// Store check-out time
async function updateCheckOutAttendance() {
  try {
    const checkOutTime = formatDateTime(new Date());
    let reqData = {
      url: "https://people.zoho.in/people/api/attendance",
      connectiondetails: "workfromhome",
      method: "POST",
      apiParams: {
        checkOut: checkOutTime,
        empId: currentUser.empid,
      },
    };
    const data = await ZOHO.People.API.invokeUrl(reqData);
    // localStorage.setItem(getCheckTimeKey("checkOut"), checkOutTime);
    console.log("api response of checkout", data);
  } catch (e) {
    console.warn("localStorage unavailable; cannot store check-out time", e);
  }
}

function resetTimerDisplay() {
  let timerDisplay = document.getElementById("timerDisplay");
  if (timerDisplay) {
    timerDisplay.textContent = "00:00:00";
  }
}

function startOrResumeTimer() {
  // If timerDate is not today, reset everything
  const today = getTodayString();
  if (timerDate !== today) {
    pausedTime = 0;
    timerDate = today;
  }
  timerStartTime = Date.now();
  let timerDisplay = document.getElementById("timerDisplay");

  // Show the correct time on resume
  timerDisplay.textContent = formatTime(pausedTime);

  // Clear any previous interval
  if (timerInterval) {
    clearInterval(timerInterval);
  }

  timerInterval = setInterval(function () {
    // If the day has changed, reset timer
    const nowDay = getTodayString();
    if (nowDay !== timerDate) {
      pausedTime = 0;
      timerDate = nowDay;
      timerStartTime = Date.now();
      timerDisplay.textContent = "00:00:00";
      return;
    }
    let elapsed = Date.now() - timerStartTime + pausedTime;
    timerDisplay.textContent = formatTime(elapsed);
  }, 1000);
}

function pauseTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  if (timerStartTime) {
    pausedTime += Date.now() - timerStartTime;
    timerStartTime = null;
  }
}

// === Office Coordinates ===
const OFFICE_LAT = 12.9172438; //  Bangalore
const OFFICE_LNG = 77.6278552;
const ALLOWED_RADIUS = 0.5; // in kilometers (500 meters)

// === Get User Location ===
function checkUserLocation() {
  let userLat = null;
  let userLng = null;
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      console.warn("Geolocation is not supported by your browser.");
      resolve(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        console.log("position", position);
        userLat = position.coords.latitude;
        userLng = position.coords.longitude;

        // Calculate distance using Haversine formula
        const distance = getDistanceFromLatLonInKm(
          OFFICE_LAT,
          OFFICE_LNG,
          userLat,
          userLng
        );

        console.log(`User is ${distance.toFixed(3)} km away from office.`);

        if (distance <= ALLOWED_RADIUS) {
          console.log("within range");
          resolve(true);
        } else {
          console.log("outside range");
          resolve(false);
        }
      },
      (err) => {
        console.error("Error getting location:", err);
        if (err.code === err.PERMISSION_DENIED) {
          console.warn(
            "Location permission denied. Allowing remote work as fallback."
          );
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          console.warn(
            "Location unavailable. Allowing remote work as fallback."
          );
        }
        // Fallback: allow remote work if geolocation fails
        resolve(false);
      },
      {
        timeout: 10000,
        enableHighAccuracy: false,
        maximumAge: 300000, // 5 minutes
      }
    );
  });
}

// === On Error ===
function error(err) {
  console.error("Error getting location:", err);
  return false;
}

// === Haversine Formula ===
function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth radius in km
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) *
      Math.cos(deg2rad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c; // Distance in km
  return distance;
}

function deg2rad(deg) {
  return deg * (Math.PI / 180);
}

// checks if the current user has work from home credits
async function checkWorkFromHomeCredits() {
  //   let input = {url: <url to invoke>,
  // 	connectiondetails:"name=<connection-name>",
  // 	params : <url params>, // url parameters optional
  // 	methodType: <GET|POST|PUT|DELETE>;
  // 	extraParam: <url headers>}; // url headers optional
  // };

  const urlENCODE = new URLSearchParams();
  urlENCODE.append(
    "inputData",
    `{\"Number_of_available_Work_From_Home\":${
      Number(employeeFormData.Number_of_available_Work_From_Home) - 1
    }}`
  );

  let reqData = {
    url: "https://people.zoho.in/api/forms/json/employee/updateRecord",
    connectiondetails: "workfromhome",
    method: "POST",
    apiParams: {
      recordId: currentUser.usererec,
      inputData: urlENCODE.get("inputData"),
    },
  };
  const data = await ZOHO.People.API.invokeUrl(reqData);
  console.log("employee data", data);
}

async function getEmployeeFormData() {
  let employeeFormData = await ZOHO.People.API.getFormRecord({
    recordId: currentUser.usererec,
    formName: "P_Employee",
  });
  let creditValue = document.querySelector(".credit-value");
  creditValue.textContent = "";
  creditValue.textContent = employeeFormData.Number_of_available_Work_From_Home;
  return employeeFormData;
}
