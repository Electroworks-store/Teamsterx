# TeamHub - Internal Team Collaboration Platform

A professional, Microsoft Teams-inspired internal team hub application for small teams. Built with HTML, CSS, and JavaScript with Firebase Firestore integration for real-time collaboration.

![TeamHub](https://img.shields.io/badge/Version-1.0.0-blue)
![License](https://img.shields.io/badge/License-MIT-green)

## 🚀 Features

### 📊 Activity Feed
- Real-time activity stream
- Track team actions (messages, tasks, events)
- Time-stamped updates

### 💬 Team Chat
- Real-time messaging
- Message history
- User avatars and timestamps
- Smooth animations

### 📅 Shared Calendar
- Monthly calendar view
- Event scheduling
- Upcoming events list
- Visual event indicators
- Date navigation

### ✅ Task Management
- Kanban-style board (To Do, In Progress, Done)
- Task assignments
- Priority levels (Low, Medium, High)
- Task descriptions
- Drag-and-drop ready structure

### 🎨 Design
- Modern blue and white color scheme (Microsoft Teams inspired)
- Responsive layout
- Smooth animations and transitions
- Professional UI components
- Mobile-friendly design

## 📋 Prerequisites

- A modern web browser (Chrome, Firefox, Safari, Edge)
- A code editor (VS Code recommended)
- Firebase account (for database integration)
- Basic knowledge of HTML, CSS, and JavaScript

## 🛠️ Installation

### 1. Clone or Download
```bash
# If using Git
git clone <repository-url>

# Or download the files directly to your project folder
```

### 2. Project Structure
```
TeamApp/
│
├── index.html           # Main HTML structure
├── styles.css           # Styling and theme
├── main.js              # Application logic
├── firebase-config.js   # Firebase configuration
└── README.md            # This file
```

### 3. Local Development
Simply open `index.html` in your web browser:
- Double-click `index.html`, or
- Right-click → Open with → Your Browser, or
- Use a local server (recommended):

```bash
# Using Python 3
python -m http.server 8000

# Using Node.js (http-server)
npx http-server

# Using VS Code Live Server extension
# Right-click index.html → "Open with Live Server"
```

Then navigate to `http://localhost:8000`

## 🔥 Firebase Setup

### Step 1: Create Firebase Project
1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click "Add project"
3. Enter project name (e.g., "TeamHub")
4. Follow the setup wizard

### Step 2: Add Web App
1. In your Firebase project, click the web icon (</>)
2. Register your app with a nickname
3. Copy the Firebase configuration object

### Step 3: Configure Firebase
1. Open `main.js`
2. Find the `firebaseConfig` object (around line 5)
3. Replace placeholder values with your actual config:

```javascript
const firebaseConfig = {
    apiKey: "YOUR_ACTUAL_API_KEY",
    authDomain: "your-project.firebaseapp.com",
    projectId: "your-project-id",
    storageBucket: "your-project.appspot.com",
    messagingSenderId: "123456789",
    appId: "your-app-id"
};
```

### Step 4: Enable Firestore
1. In Firebase Console, go to "Firestore Database"
2. Click "Create database"
3. Choose "Start in test mode" (for development)
4. Select a Cloud Firestore location
5. Click "Enable"

### Step 5: Set Security Rules
1. Go to Firestore → Rules
2. Copy the rules from `firebase-config.js`
3. Paste and publish the rules

**Note:** Test mode rules allow anyone to read/write. For production, implement proper authentication and rules!

## 📱 Usage

### Navigation
- Click sidebar icons to switch between sections:
  - **Activity**: View team activity feed
  - **Chat**: Send and receive messages
  - **Calendar**: View and create events
  - **Tasks**: Manage team tasks

### Chat
1. Click on "Chat" in the sidebar
2. Type your message in the input field
3. Press Enter or click the send button
4. Messages are saved locally (and to Firestore when configured)

### Calendar
1. Navigate to "Calendar" section
2. Use arrow buttons to change months
3. Click "Add Event" to create new events
4. Fill in event details and submit
5. Events appear in the calendar and upcoming events list

### Tasks
1. Go to "Tasks" section
2. Click "Add Task" to create a new task
3. Fill in task details:
   - Title and description
   - Assign to team member
   - Set priority level
4. Tasks appear in the "To Do" column
5. Click trash icon to delete tasks

### Search
- Use the search bar at the top to search through:
  - Messages
  - Tasks
  - Events
  - Team members

## 🎨 Customization

### Colors
Edit CSS variables in `styles.css`:
```css
:root {
    --primary-blue: #0078D4;    /* Main brand color */
    --primary-dark: #005A9E;    /* Darker shade */
    --primary-light: #50A0E8;   /* Lighter shade */
    /* ... more variables ... */
}
```

### User Information
Edit in `main.js`:
```javascript
const appState = {
    currentUser: 'Your Name',  // Change to your name
    // ...
};
```

### Team Members
Edit task assignee options in `index.html`:
```html
<select id="taskAssignee">
    <option value="Team Member 1">Team Member 1</option>
    <option value="Team Member 2">Team Member 2</option>
    <!-- Add your team members -->
</select>
```

## 🔧 Advanced Features

### Local Storage
The app uses localStorage as a fallback when Firebase is not configured:
- Messages are stored locally
- Tasks persist across sessions
- Events are saved locally
- Activities are tracked

### Firebase Integration
When properly configured, the app will:
- Sync data in real-time
- Share data across all team members
- Persist data in the cloud
- Enable multi-device access

### Future Enhancements
Ready-to-implement features:
- [ ] User authentication
- [ ] File sharing
- [ ] Video calls integration
- [ ] Notifications
- [ ] Dark mode
- [ ] Email notifications
- [ ] Task drag-and-drop
- [ ] Calendar event reminders
- [ ] User presence indicators

## 🐛 Troubleshooting

### Chat messages not sending
- Check browser console for errors
- Verify Firebase configuration
- Ensure Firestore is enabled

### Calendar not displaying
- Clear browser cache
- Check date/time settings
- Verify JavaScript is enabled

### Tasks not saving
- Check localStorage is available
- Verify Firebase configuration
- Check browser console for errors

### Firebase errors
- Verify all config values are correct
- Ensure Firestore is enabled
- Check security rules
- Verify billing is set up (Firebase Spark plan is free)

## 📊 Browser Support

- Chrome (recommended) - Latest
- Firefox - Latest
- Safari - Latest
- Edge - Latest
- Mobile browsers - iOS Safari, Chrome Mobile

## 🔒 Security Notes

⚠️ **Important for Production:**

1. **Never expose API keys** in public repositories
2. Implement proper **authentication** (Firebase Auth)
3. Set up **proper security rules** in Firestore
4. Use **environment variables** for sensitive data
5. Enable **App Check** for additional security
6. Implement **rate limiting**

## 📄 License

MIT License - feel free to use this project for personal or commercial purposes.

## 👥 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📞 Support

For issues or questions:
- Check the troubleshooting section
- Review Firebase documentation
- Check browser console for errors
- Review the code comments

## 🎯 Project Status

**Current Version:** 1.0.0  
**Status:** Ready for development use  
**Last Updated:** October 2025

## 📚 Resources

- [Firebase Documentation](https://firebase.google.com/docs)
- [Firestore Guide](https://firebase.google.com/docs/firestore)
- [MDN Web Docs](https://developer.mozilla.org/)
- [Font Awesome Icons](https://fontawesome.com/icons)

## 🙏 Acknowledgments

- Design inspired by Microsoft Teams
- Icons by Font Awesome
- Firebase by Google

---

**Built with ❤️ for small teams everywhere**
