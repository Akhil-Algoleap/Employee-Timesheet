# Data Locking & Month-Based Processing Walkthrough

The system has been updated to automatically determine target months based on submission rules, protect finalized data from being overwritten, and calculate PLs accurately based on finalized historical data.

## 1. Dynamic Month Processing
The system now intelligently decides which month a timesheet belongs to based on the date it is received in the system:
- **>= 20th of the month**: Processes as the **Current Month**.
- **<= 19th of the month**: Processes as the **Previous Month**.

The parser will strictly ignore any sheet inside the Excel file that does not match this calculated target month.

## 2. Data Locking (Finalization)
To protect data integrity after manual review:
- A new **Finalized** column has been added to the TimeSheet view.
- You can check the box next to an individual employee's name and click **Save All** to lock their data.
- Alternatively, you can use the **Finalize All** button at the top to instantly lock all employees currently displayed in the filtered view.
- Once an employee's month is locked, future automated Excel uploads will completely bypass them, preserving any manual corrections you made.

## 3. Accurate PL Calculation
The parser's Privilege Leave (PL) calculation logic has been updated:
- When calculating if an employee has exceeded their 3 PL limit for the quarter, the system will only sum up PLs from previous months if those months have been officially **Finalized**.
- This ensures that unreviewed/unlocked data from previous months doesn't incorrectly trigger LWP (Leave Without Pay) conversions in the current month.

> [!TIP]
> You can easily test this by finalizing a few records on the frontend, then dropping an Excel file into the Outlook folder to verify that those specific rows do not get overwritten.
