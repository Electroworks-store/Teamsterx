# Deploy Firestore Rules - URGENT FIX

## Problem
You're getting "Missing or insufficient permissions" because Firestore rules aren't published yet.

## Solution - Deploy Rules Now (2 minutes)

### Step 1: Copy the Rules
The correct rules are in `firestore.rules` file. Copy ALL the content from that file.

### Step 2: Go to Firebase Console
1. Open: https://console.firebase.google.com/
2. Select your project: **teamconnect-280e9**
3. In left sidebar, click **Firestore Database**
4. Click the **Rules** tab at the top

### Step 3: Paste and Publish
1. **DELETE** all existing rules in the editor
2. **PASTE** the content from `firestore.rules`
3. Click **Publish** button (blue button at top)
4. Wait for "Rules published successfully" message

### Step 4: Test
1. Go back to your app
2. Refresh the page (Ctrl+F5)
3. Try creating an event
4. It should work! ✅

## What These Rules Do

✅ **Users**: Can only access their own user document  
✅ **Teams**: Members can read, owner can update  
✅ **Events** (subcollection): All team members can create/read/update/delete  
✅ **Tasks** (subcollection): All team members can create/read/update/delete  
✅ **Messages** (subcollection): All team members can create/read/update/delete  
✅ **Activities** (subcollection): All team members can create/read (activity feed)  
✅ **Join Requests**: Authenticated users can read/write  

## Security Features

- ✅ Team members can only access their own team's data
- ✅ Users must be authenticated
- ✅ Events/tasks/messages are scoped to teams (subcollections)
- ✅ Owner control for team management

## After Publishing

Once you publish the rules, you should see:
- ✅ Events save successfully
- ✅ Events load on page refresh
- ✅ Real-time sync across team members
- ✅ Tasks and messages also work
- ✅ No more permission errors

---

**DO THIS NOW** - It takes less than 2 minutes! 🚀
