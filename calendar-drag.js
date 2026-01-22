/**
 * Calendar Drag & Drop System
 * 
 * A high-precision drag-and-drop system for calendar events with 15-minute snapping,
 * cross-day dragging, and Apple Calendar-like smooth behavior.
 * 
 * Architecture:
 * - CalendarDragConfig: Grid metrics and configuration
 * - CalendarTimeUtils: Time snapping and calculations
 * - CalendarDragPreview: Visual feedback during drag
 * - CalendarDragHandler: Pointer event handling
 */

// ===================================
// CONFIGURATION & CONSTANTS
// ===================================

const CalendarDragConfig = {
    // Grid metrics (px)
    SLOT_HEIGHT: 60,          // Height per hour in pixels
    START_HOUR: 6,            // First visible hour (06:00)
    END_HOUR: 22,             // Last visible hour (22:00)
    MIN_EVENT_HEIGHT: 30,     // Minimum event height (30 minutes)
    
    // Snapping
    SNAP_INTERVAL: 15,        // Snap to 15-minute increments
    
    // Thresholds
    DRAG_THRESHOLD: 5,        // Pixels moved before drag starts
    
    // Animation
    TRANSITION_DURATION: 80,  // ms for snapping transitions
    
    // Working hours (optional clamp)
    WORKING_HOURS_START: 6,
    WORKING_HOURS_END: 22,
    ENFORCE_WORKING_HOURS: false,
    
    // Computed values
    get SNAP_HEIGHT() {
        return this.SLOT_HEIGHT / (60 / this.SNAP_INTERVAL);
    },
    get TOTAL_HOURS() {
        return this.END_HOUR - this.START_HOUR;
    },
    get TOTAL_HEIGHT() {
        return this.TOTAL_HOURS * this.SLOT_HEIGHT;
    }
};

// ===================================
// TIME UTILITIES
// ===================================

const CalendarTimeUtils = {
    /**
     * Snap minutes to the nearest 15-minute interval
     * @param {number} minutes - Total minutes from midnight
     * @returns {number} Snapped minutes
     */
    snapToInterval(minutes, interval = CalendarDragConfig.SNAP_INTERVAL) {
        return Math.round(minutes / interval) * interval;
    },
    
    /**
     * Snap a Date to the nearest 15-minute interval
     * @param {Date} date - The date to snap
     * @returns {Date} A new Date snapped to 15 minutes
     */
    snapDate(date) {
        const result = new Date(date);
        const minutes = result.getMinutes();
        const snappedMinutes = this.snapToInterval(minutes);
        result.setMinutes(snappedMinutes, 0, 0);
        return result;
    },
    
    /**
     * Convert pixel position to time (minutes from start of day)
     * @param {number} pixelY - Vertical position in pixels from grid top
     * @returns {number} Minutes from midnight
     */
    pixelToMinutes(pixelY) {
        const minutesFromStart = (pixelY / CalendarDragConfig.SLOT_HEIGHT) * 60;
        const totalMinutes = CalendarDragConfig.START_HOUR * 60 + minutesFromStart;
        return this.snapToInterval(totalMinutes);
    },
    
    /**
     * Convert time (minutes from midnight) to pixel position
     * @param {number} minutes - Minutes from midnight
     * @returns {number} Pixel position from grid top
     */
    minutesToPixel(minutes) {
        const minutesFromStart = minutes - (CalendarDragConfig.START_HOUR * 60);
        return (minutesFromStart / 60) * CalendarDragConfig.SLOT_HEIGHT;
    },
    
    /**
     * Extract hour and minute from total minutes
     * @param {number} totalMinutes - Minutes from midnight
     * @returns {{hour: number, minute: number}}
     */
    minutesToTime(totalMinutes) {
        const clamped = Math.max(0, Math.min(24 * 60 - 1, totalMinutes));
        return {
            hour: Math.floor(clamped / 60),
            minute: clamped % 60
        };
    },
    
    /**
     * Convert hour and minute to total minutes
     * @param {number} hour 
     * @param {number} minute 
     * @returns {number}
     */
    timeToMinutes(hour, minute) {
        return hour * 60 + minute;
    },
    
    /**
     * Format time as HH:MM (24-hour format)
     * @param {number} hour 
     * @param {number} minute 
     * @returns {string}
     */
    formatTime24(hour, minute) {
        return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    },
    
    /**
     * Format a time range
     * @param {number} startMinutes 
     * @param {number} endMinutes 
     * @returns {string}
     */
    formatTimeRange(startMinutes, endMinutes) {
        const start = this.minutesToTime(startMinutes);
        const end = this.minutesToTime(endMinutes);
        return `${this.formatTime24(start.hour, start.minute)} – ${this.formatTime24(end.hour, end.minute)}`;
    },
    
    /**
     * Clamp time to valid calendar bounds
     * @param {number} minutes - Minutes from midnight
     * @returns {number} Clamped minutes
     */
    clampToCalendarBounds(minutes) {
        const minMinutes = CalendarDragConfig.START_HOUR * 60;
        const maxMinutes = CalendarDragConfig.END_HOUR * 60;
        
        if (CalendarDragConfig.ENFORCE_WORKING_HOURS) {
            const workMin = CalendarDragConfig.WORKING_HOURS_START * 60;
            const workMax = CalendarDragConfig.WORKING_HOURS_END * 60;
            return Math.max(workMin, Math.min(workMax, minutes));
        }
        
        return Math.max(minMinutes, Math.min(maxMinutes, minutes));
    },
    
    /**
     * Calculate duration in minutes between two Date objects
     * @param {Date} start 
     * @param {Date} end 
     * @returns {number}
     */
    calculateDuration(start, end) {
        return Math.max(CalendarDragConfig.SNAP_INTERVAL, Math.round((end - start) / (1000 * 60)));
    }
};

// ===================================
// DRAG PREVIEW (Visual Feedback)
// ===================================

const CalendarDragPreview = {
    previewElement: null,
    timeIndicator: null,
    highlightedColumn: null,
    highlightedSlot: null,
    
    /**
     * Create the floating preview element
     */
    createPreview(eventElement, title, color) {
        // Remove any existing preview
        this.destroyPreview();
        
        // Create preview container
        const preview = document.createElement('div');
        preview.className = 'calendar-drag-preview';
        preview.innerHTML = `
            <div class="drag-preview-content">
                <div class="drag-preview-title">${this.escapeHtml(title)}</div>
                <div class="drag-preview-time"></div>
            </div>
        `;
        preview.style.setProperty('--event-color', color || '#007AFF');
        
        // Match dimensions to original event
        const rect = eventElement.getBoundingClientRect();
        preview.style.width = `${rect.width}px`;
        preview.style.minHeight = `${rect.height}px`;
        
        document.body.appendChild(preview);
        this.previewElement = preview;
        
        // Create time indicator that appears in the time column
        const timeIndicator = document.createElement('div');
        timeIndicator.className = 'calendar-drag-time-indicator';
        document.body.appendChild(timeIndicator);
        this.timeIndicator = timeIndicator;
        
        return preview;
    },
    
    /**
     * Update preview position and time display
     */
    updatePreview(x, y, startMinutes, endMinutes, dayColumn) {
        if (!this.previewElement) return;
        
        // Position the preview element
        this.previewElement.style.left = `${x}px`;
        this.previewElement.style.top = `${y}px`;
        
        // Update time display
        const timeEl = this.previewElement.querySelector('.drag-preview-time');
        if (timeEl) {
            timeEl.textContent = CalendarTimeUtils.formatTimeRange(startMinutes, endMinutes);
        }
        
        // Update time indicator in the time column
        if (this.timeIndicator && dayColumn) {
            const scrollContainer = dayColumn.closest('.week-view-scroll-container');
            const timeScaffold = dayColumn.closest('.week-colview')?.querySelector('.week-time-scaffold');
            
            if (timeScaffold && scrollContainer) {
                const scaffoldRect = timeScaffold.getBoundingClientRect();
                const pixelY = CalendarTimeUtils.minutesToPixel(startMinutes);
                const scrollOffset = scrollContainer.scrollTop;
                
                // Position relative to viewport
                const indicatorY = scaffoldRect.top + pixelY - scrollOffset + 40; // +40 for header
                
                this.timeIndicator.style.top = `${indicatorY}px`;
                this.timeIndicator.style.left = `${scaffoldRect.left}px`;
                this.timeIndicator.style.width = `${scaffoldRect.width}px`;
                this.timeIndicator.textContent = CalendarTimeUtils.formatTime24(
                    ...Object.values(CalendarTimeUtils.minutesToTime(startMinutes))
                );
                this.timeIndicator.style.display = 'block';
            }
        }
    },
    
    /**
     * Highlight the target day column
     */
    highlightColumn(column) {
        // Remove previous highlight
        if (this.highlightedColumn && this.highlightedColumn !== column) {
            this.highlightedColumn.classList.remove('drag-target-column');
        }
        
        if (column) {
            column.classList.add('drag-target-column');
            this.highlightedColumn = column;
        }
    },
    
    /**
     * Highlight the target time slot
     */
    highlightTimeSlot(column, startMinutes) {
        // Remove previous slot highlight
        if (this.highlightedSlot) {
            this.highlightedSlot.classList.remove('drag-target-slot');
        }
        
        if (!column) return;
        
        // Calculate which grid cell to highlight
        const hourFromTop = Math.floor((startMinutes / 60) - CalendarDragConfig.START_HOUR);
        const cells = column.querySelectorAll('.week-grid-cell');
        
        if (cells[hourFromTop]) {
            cells[hourFromTop].classList.add('drag-target-slot');
            this.highlightedSlot = cells[hourFromTop];
        }
    },
    
    /**
     * Clean up all preview elements
     */
    destroyPreview() {
        if (this.previewElement) {
            this.previewElement.remove();
            this.previewElement = null;
        }
        
        if (this.timeIndicator) {
            this.timeIndicator.remove();
            this.timeIndicator = null;
        }
        
        if (this.highlightedColumn) {
            this.highlightedColumn.classList.remove('drag-target-column');
            this.highlightedColumn = null;
        }
        
        if (this.highlightedSlot) {
            this.highlightedSlot.classList.remove('drag-target-slot');
            this.highlightedSlot = null;
        }
    },
    
    /**
     * Escape HTML to prevent XSS
     */
    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str || '';
        return div.innerHTML;
    }
};

// ===================================
// DRAG HANDLER (Pointer Events)
// ===================================

const CalendarDragHandler = {
    // State
    isDragging: false,
    dragStarted: false,
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0,
    offsetX: 0,
    offsetY: 0,
    
    // Event data
    draggedEventId: null,
    draggedElement: null,
    originalStartMinutes: 0,
    eventDurationMinutes: 0,
    eventColor: null,
    eventTitle: '',
    originalDate: null,
    occurrenceDate: null,
    
    // Grid reference
    activeColumn: null,
    gridContainer: null,
    pointerId: null,
    
    // Bound handlers (for proper removal)
    _boundPointerDown: null,
    _boundPointerMove: null,
    _boundPointerUp: null,
    
    /**
     * Initialize drag handlers for all week view events
     */
    init() {
        // Use event delegation on the calendar container for better performance
        const calendarDays = document.getElementById('calendarDays');
        if (!calendarDays) return;
        
        // Create bound handlers if not already created
        if (!this._boundPointerDown) {
            this._boundPointerDown = this.handlePointerDown.bind(this);
            this._boundPointerMove = this.handlePointerMove.bind(this);
            this._boundPointerUp = this.handlePointerUp.bind(this);
        }
        
        // Remove any existing listeners
        calendarDays.removeEventListener('pointerdown', this._boundPointerDown);
        
        // Add pointer event listener
        calendarDays.addEventListener('pointerdown', this._boundPointerDown);
        
        console.log('[CalendarDrag] Initialized pointer-based drag system');
    },
    
    /**
     * Handle pointer down on event elements
     */
    handlePointerDown(e) {
        // Only handle left mouse button or touch
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        
        // Find the event element
        const eventEl = e.target.closest('.week-col-event[draggable="true"]');
        if (!eventEl) return;
        
        // Don't start drag if clicking on resize handles
        if (e.target.closest('.week-event-resize-handle')) return;
        
        // Prevent default to avoid text selection
        e.preventDefault();
        
        // Store pointer ID for capture
        this.pointerId = e.pointerId;
        
        // Store initial state
        this.draggedElement = eventEl;
        this.draggedEventId = eventEl.dataset.eventId;
        this.occurrenceDate = eventEl.dataset.occurrenceDate;
        this.eventTitle = eventEl.querySelector('.week-event-title')?.textContent || 'Event';
        this.eventColor = eventEl.style.borderLeftColor || '#007AFF';
        
        // Get event timing from data attributes
        this.originalStartMinutes = parseInt(eventEl.dataset.startMinutes) || 0;
        const endMinutes = parseInt(eventEl.dataset.endMinutes) || this.originalStartMinutes + 60;
        this.eventDurationMinutes = endMinutes - this.originalStartMinutes;
        
        // Get original date from parent column
        const column = eventEl.closest('.week-day-column');
        this.originalDate = column ? new Date(column.dataset.date) : new Date();
        
        // Calculate click offset within the event
        const eventRect = eventEl.getBoundingClientRect();
        this.offsetX = e.clientX - eventRect.left;
        this.offsetY = e.clientY - eventRect.top;
        
        // Store starting position
        this.startX = e.clientX;
        this.startY = e.clientY;
        this.currentX = e.clientX;
        this.currentY = e.clientY;
        
        // Mark that we're potentially starting a drag
        this.isDragging = true;
        this.dragStarted = false;
        
        // Find grid container
        this.gridContainer = eventEl.closest('.week-colview');
        
        // Add move and up listeners to document
        document.addEventListener('pointermove', this._boundPointerMove, { passive: false });
        document.addEventListener('pointerup', this._boundPointerUp);
        document.addEventListener('pointercancel', this._boundPointerUp);
        
        // Set pointer capture for reliable tracking
        eventEl.setPointerCapture(e.pointerId);
    },
    
    /**
     * Handle pointer move during drag
     */
    handlePointerMove(e) {
        if (!this.isDragging) return;
        
        e.preventDefault();
        
        this.currentX = e.clientX;
        this.currentY = e.clientY;
        
        // Check if we've moved enough to start dragging
        if (!this.dragStarted) {
            const deltaX = Math.abs(this.currentX - this.startX);
            const deltaY = Math.abs(this.currentY - this.startY);
            
            if (deltaX > CalendarDragConfig.DRAG_THRESHOLD || 
                deltaY > CalendarDragConfig.DRAG_THRESHOLD) {
                this.startDrag();
            }
            return;
        }
        
        // Update drag
        this.updateDrag();
    },
    
    /**
     * Actually start the drag operation (after threshold exceeded)
     */
    startDrag() {
        this.dragStarted = true;
        
        // Add dragging class to original element
        this.draggedElement.classList.add('dragging');
        
        // Create floating preview
        CalendarDragPreview.createPreview(
            this.draggedElement,
            this.eventTitle,
            this.eventColor
        );
        
        // Disable transitions on preview for smoother feel
        document.body.classList.add('calendar-dragging');
        
        console.log('[CalendarDrag] Drag started for:', this.draggedEventId);
    },
    
    /**
     * Update drag position and calculate new time
     */
    updateDrag() {
        if (!this.gridContainer) return;
        
        // Find which column we're over
        const columns = this.gridContainer.querySelectorAll('.week-day-column');
        let targetColumn = null;
        let columnRect = null;
        
        for (const column of columns) {
            const rect = column.getBoundingClientRect();
            if (this.currentX >= rect.left && this.currentX <= rect.right) {
                targetColumn = column;
                columnRect = rect;
                break;
            }
        }
        
        // Highlight the target column
        CalendarDragPreview.highlightColumn(targetColumn);
        
        if (!targetColumn || !columnRect) return;
        
        this.activeColumn = targetColumn;
        
        // Get the grid area (excluding header)
        const dayGrid = targetColumn.querySelector('.week-day-grid');
        if (!dayGrid) return;
        
        const gridRect = dayGrid.getBoundingClientRect();
        
        // Calculate position relative to grid top, accounting for offset
        const rawY = this.currentY - this.offsetY - gridRect.top;
        
        // Convert to minutes and snap
        const pixelPosition = Math.max(0, rawY);
        const rawMinutes = CalendarTimeUtils.pixelToMinutes(pixelPosition);
        
        // Snap to 15-minute intervals
        const snappedMinutes = CalendarTimeUtils.snapToInterval(rawMinutes);
        
        // Clamp to calendar bounds
        const clampedMinutes = CalendarTimeUtils.clampToCalendarBounds(snappedMinutes);
        
        // Make sure event doesn't extend past end of day
        const maxStartMinutes = CalendarDragConfig.END_HOUR * 60 - this.eventDurationMinutes;
        const finalStartMinutes = Math.min(clampedMinutes, maxStartMinutes);
        
        // Calculate end time
        const endMinutes = finalStartMinutes + this.eventDurationMinutes;
        
        // Calculate preview position
        const previewY = gridRect.top + CalendarTimeUtils.minutesToPixel(finalStartMinutes);
        const previewX = columnRect.left + (columnRect.width - this.draggedElement.offsetWidth) / 2;
        
        // Update preview
        CalendarDragPreview.updatePreview(
            previewX,
            previewY,
            finalStartMinutes,
            endMinutes,
            targetColumn
        );
        
        // Highlight time slot
        CalendarDragPreview.highlightTimeSlot(targetColumn, finalStartMinutes);
        
        // Store calculated values for drop
        this._calculatedStartMinutes = finalStartMinutes;
        this._calculatedEndMinutes = endMinutes;
        this._targetDate = new Date(targetColumn.dataset.date);
    },
    
    /**
     * Handle pointer up (end drag)
     */
    async handlePointerUp(e) {
        if (!this.isDragging) return;
        
        // Remove listeners using bound handlers
        document.removeEventListener('pointermove', this._boundPointerMove);
        document.removeEventListener('pointerup', this._boundPointerUp);
        document.removeEventListener('pointercancel', this._boundPointerUp);
        
        // Clean up dragging state
        document.body.classList.remove('calendar-dragging');
        
        if (this.draggedElement) {
            this.draggedElement.classList.remove('dragging');
            try {
                if (this.pointerId !== null) {
                    this.draggedElement.releasePointerCapture(this.pointerId);
                }
            } catch (err) {
                // Ignore - pointer capture may have already been released
            }
        }
        
        // Clean up preview
        CalendarDragPreview.destroyPreview();
        
        // If drag actually started and we have a valid drop target, reschedule
        if (this.dragStarted && this._targetDate && this._calculatedStartMinutes !== undefined) {
            const startTime = CalendarTimeUtils.minutesToTime(this._calculatedStartMinutes);
            const endTime = CalendarTimeUtils.minutesToTime(this._calculatedEndMinutes);
            
            console.log('[CalendarDrag] Dropping event:', {
                eventId: this.draggedEventId,
                targetDate: this._targetDate.toDateString(),
                startTime: CalendarTimeUtils.formatTime24(startTime.hour, startTime.minute),
                endTime: CalendarTimeUtils.formatTime24(endTime.hour, endTime.minute)
            });
            
            // Call the reschedule function if available
            if (typeof window.rescheduleEventWithPrecision === 'function') {
                await window.rescheduleEventWithPrecision(
                    this.draggedEventId,
                    this._targetDate,
                    startTime.hour,
                    startTime.minute,
                    endTime.hour,
                    endTime.minute
                );
            } else if (typeof rescheduleEvent === 'function') {
                // Fallback to existing function
                const newDate = new Date(this._targetDate);
                newDate.setHours(startTime.hour, startTime.minute, 0, 0);
                await rescheduleEvent(this.draggedEventId, newDate, startTime.hour, startTime.minute);
            }
        } else if (!this.dragStarted && this.draggedEventId) {
            // It was a click, not a drag - trigger event details view
            const occurrenceDate = this.occurrenceDate;
            const eventId = this.draggedEventId;
            // Use global function if available
            if (typeof window.viewEventDetails === 'function') {
                window.viewEventDetails(eventId, occurrenceDate);
            }
        }
        
        // Reset state
        this.reset();
    },
    
    /**
     * Reset all drag state
     */
    reset() {
        this.isDragging = false;
        this.dragStarted = false;
        this.startX = 0;
        this.startY = 0;
        this.currentX = 0;
        this.currentY = 0;
        this.offsetX = 0;
        this.offsetY = 0;
        this.draggedEventId = null;
        this.draggedElement = null;
        this.originalStartMinutes = 0;
        this.eventDurationMinutes = 0;
        this.eventColor = null;
        this.eventTitle = '';
        this.originalDate = null;
        this.occurrenceDate = null;
        this.activeColumn = null;
        this.gridContainer = null;
        this.pointerId = null;
        this._calculatedStartMinutes = undefined;
        this._calculatedEndMinutes = undefined;
        this._targetDate = null;
    }
};

// ===================================
// PUBLIC API
// ===================================

/**
 * Initialize the calendar drag system
 * Call this after rendering the week view
 */
function initCalendarPrecisionDrag() {
    CalendarDragHandler.init();
}

/**
 * Reschedule an event with full precision (hour, minute for both start and end)
 * This is the callback used by the drag system
 */
async function rescheduleEventWithPrecision(eventId, newDate, startHour, startMinute, endHour, endMinute) {
    // Find the event in appState
    const event = appState?.events?.find(e => e.id === eventId);
    if (!event) {
        console.error('[CalendarDrag] Event not found:', eventId);
        if (typeof showToast === 'function') {
            showToast('Event not found', 'error');
        }
        return;
    }
    
    // Create new start and end dates
    const newStartDate = new Date(newDate);
    newStartDate.setHours(startHour, startMinute, 0, 0);
    
    const newEndDate = new Date(newDate);
    newEndDate.setHours(endHour, endMinute, 0, 0);
    
    // Ensure end is after start
    if (newEndDate <= newStartDate) {
        newEndDate.setTime(newStartDate.getTime() + 30 * 60 * 1000);
    }
    
    // Update local state
    event.date = newStartDate;
    event.endDate = newEndDate;
    event.time = newStartDate.toLocaleTimeString('en-US', { 
        hour: '2-digit', minute: '2-digit', hour12: false 
    });
    event.endTime = newEndDate.toLocaleTimeString('en-US', { 
        hour: '2-digit', minute: '2-digit', hour12: false 
    });
    
    // Update in Firestore
    try {
        if (typeof updateEventInFirestore === 'function') {
            await updateEventInFirestore(event);
        }
        
        const timeStr = CalendarTimeUtils.formatTime24(startHour, startMinute);
        const dayStr = newDate.toLocaleDateString('en-US', { 
            weekday: 'short', month: 'short', day: 'numeric' 
        });
        
        if (typeof showToast === 'function') {
            showToast(`Moved to ${dayStr} at ${timeStr}`, 'success');
        }
        
        // Re-render calendar while preserving scroll position
        const scrollContainer = document.querySelector('.week-view-scroll-container');
        const scrollTop = scrollContainer ? scrollContainer.scrollTop : 0;
        
        if (typeof renderCalendar === 'function') {
            renderCalendar();
        }
        
        // Restore scroll position
        requestAnimationFrame(() => {
            const newScrollContainer = document.querySelector('.week-view-scroll-container');
            if (newScrollContainer) {
                newScrollContainer.scrollTop = scrollTop;
            }
            // Re-initialize drag after render
            initCalendarPrecisionDrag();
        });
        
    } catch (error) {
        console.error('[CalendarDrag] Error updating event:', error);
        if (typeof showToast === 'function') {
            showToast('Failed to move event', 'error');
        }
    }
}

// Expose to global scope
window.CalendarDragConfig = CalendarDragConfig;
window.CalendarTimeUtils = CalendarTimeUtils;
window.CalendarDragPreview = CalendarDragPreview;
window.CalendarDragHandler = CalendarDragHandler;
window.initCalendarPrecisionDrag = initCalendarPrecisionDrag;
window.rescheduleEventWithPrecision = rescheduleEventWithPrecision;

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        CalendarDragConfig,
        CalendarTimeUtils,
        CalendarDragPreview,
        CalendarDragHandler,
        initCalendarPrecisionDrag,
        rescheduleEventWithPrecision
    };
}
