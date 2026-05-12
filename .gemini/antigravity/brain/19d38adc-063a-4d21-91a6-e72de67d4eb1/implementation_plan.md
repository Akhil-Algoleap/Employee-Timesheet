# Simplify UI Stages (Received, Pending, Finalized)

This plan reorganizes the UI into three distinct stages to match the operational workflow, while removing the deprecated "Mismatched" section.

## Open Questions
> [!IMPORTANT]  
> **Handling the "Controlled Edit" Action**
> When a user clicks "Edit" on a row in the **Finalized** tab, what is the preferred behavior?
> **Option A (Recommended)**: Clicking "Edit" unlocks the row by un-finalizing it. The row is automatically moved back to the **Received** tab where the user can freely edit the cells, save, and then Finalize it again when ready.
> **Option B**: Clicking "Edit" keeps the row in the Finalized tab, but temporarily makes the cells editable just for that session.
> *Unless specified otherwise, Option A will be implemented as it maintains a strict single source of truth for "locked" data.*

## Proposed Changes

### Frontend Components

#### [MODIFY] [page.js](file:///absolute/path/to/frontend/app/page.js)
1. **Summary Cards Redesign**:
   - **Remove** the `Mismatched` card and all associated states (`mismatchedData`).
   - **Add** a new `Finalized` card (Green, 🔒 icon).
   - **Update** the `Received` card to visually represent data that is ready for review but not yet locked (e.g., Blue, 📥 icon).

2. **Tab Filtering Logic**:
   - Update the `filteredData` useMemo hook to enforce strict boundaries:
     - **Received**: `!emp.is_finalized && !emp._original_pending`
     - **Pending**: `!emp.is_finalized && emp._original_pending`
     - **Finalized**: `emp.is_finalized`

3. **TimeSheet Grid & Controlled Editing**:
   - Add a strict `contentEditable={!isWeekend && !emp.is_finalized}` constraint to all day cells. If a row is finalized, users **cannot** manually type into the grid cells.
   - In the "Finalized" column (or Actions column):
     - If the row is not finalized: Show the existing `Finalize` button.
     - If the row is finalized: Show an `Edit / Unlock` button.
   - Implement `handleUnlockRow` which sends a request to the backend to set `is_finalized: false`, freeing the row for edits.

## Verification Plan

### Manual Verification
- Verify the Mismatched tab is gone.
- Verify finalized rows appear strictly in the Finalized tab and their grid cells cannot be typed in.
- Click "Edit/Unlock" on a finalized row and ensure it moves back to the Received/Pending tab and becomes editable again.
