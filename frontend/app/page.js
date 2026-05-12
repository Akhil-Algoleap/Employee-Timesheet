"use client";

import { useState, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';

const BACKEND_URL = 'http://localhost:3001';

export default function Home() {
  return (
    <div className="container" style={{ padding: '2rem' }}>
      <div className="home-sections">
        <POSection />
        <POSheetSection />
        <EmployeeDetailsSection />
        <AutomationLogs />
      </div>
    </div>
  );
}

function POSection() {
  const getDefaultDate = () => {
    const now = new Date();
    const day = now.getDate();
    let m = now.getMonth() + 1;
    let y = now.getFullYear();
    if (day <= 19) {
      m -= 1;
      if (m === 0) {
        m = 12;
        y -= 1;
      }
    }
    return { month: m, year: y };
  };
  const initDate = getDefaultDate();

  const [year, setYear] = useState(initDate.year);
  const [month, setMonth] = useState(initDate.month); // 1-12
  const [data, setData] = useState([]);
  const [managerFilter, setManagerFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(false);
  const [selectedRows, setSelectedRows] = useState(new Set());
  const [dirtyRows, setDirtyRows] = useState(new Set());

  const matchDate = (dbDate, colDate) => {
    if (!dbDate) return false;
    if (dbDate.length === 10) return dbDate === colDate;
    const d = new Date(dbDate);
    if (isNaN(d.getTime())) return false;
    const yy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yy}-${mm}-${dd}` === colDate;
  };

  const formatDisplayDate = (dateStr) => {
    if (!dateStr) return '-';
    if (dateStr.includes('T')) return dateStr.split('T')[0];
    return dateStr;
  };

  // Generate dates for the selected month
  const calendarColumns = useMemo(() => {
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const cols = [];
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    for (let d = 1; d <= daysInMonth; d++) {
      const dateObj = new Date(Date.UTC(year, month - 1, d));
      const dd = String(d).padStart(2, '0');
      const mm = String(month).padStart(2, '0');
      cols.push({
        date: d,
        day: dayNames[dateObj.getUTCDay()],
        fullDate: `${year}-${mm}-${dd}`
      });
    }
    return cols;
  }, [year, month]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/po-data?year=${year}&month=${month}`);
      if (!res.ok) throw new Error(`Server returned ${res.status}: ${res.statusText}`);
      const json = await res.json();
      // New response format: { employees: [...], mismatched: [...] }
      if (json && json.employees) {
        setData(json.employees);
      } else {
        // Fallback for old format
        setData(json || []);
      }
    } catch (err) {
      console.error("Failed to fetch PO data:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleAddRow = () => {
    const newEmpId = 'NEW-' + Date.now();
    const newRow = {
      employee_id: newEmpId,
      employee_name: 'New Employee',
      joining_date: '',
      reporting_manager: '',
      dt_leader: '',
      client: 'CBRE',
      billing_category: 'No',
      pl_availed: '',
      total_billing_hours: '',
      approved: 'No',
      attendance: []
    };
    setData([newRow, ...data]);
    setSelectedRows(prev => new Set(prev).add(newEmpId));
  };

  const handleDeleteRow = async (emp) => {
    const isNew = emp.employee_id.startsWith('NEW-');
    const confirmed = window.confirm(
      isNew
        ? `Remove unsaved row "${emp.employee_name}"?`
        : `Are you sure you want to permanently delete "${emp.employee_name}" and all their records from the database?`
    );
    if (!confirmed) return;

    if (!isNew) {
      try {
        setLoading(true);
        const res = await fetch(`${BACKEND_URL}/api/po-data/${encodeURIComponent(emp.employee_id)}`, { method: 'DELETE' });
        if (!res.ok) {
          const err = await res.json();
          alert(`Failed to delete: ${err.error || 'Unknown error'}`);
          return;
        }
      } catch {
        alert('Error deleting row.');
        return;
      } finally {
        setLoading(false);
      }
    }

    setData(prev => prev.filter(e => e.employee_id !== emp.employee_id));
    setSelectedRows(prev => { const next = new Set(prev); next.delete(emp.employee_id); return next; });
  };

  const handleEdit = (employee_id, field, value) => {
    setDirtyRows(prev => new Set(prev).add(employee_id));
    setData(prevData => prevData.map(emp => {
      if (emp.employee_id === employee_id) {
        return { ...emp, [field]: value };
      }
      return emp;
    }));
    // Keep selectedRows in sync when employee_id itself is changed
    if (field === 'employee_id') {
      setSelectedRows(prev => {
        const next = new Set(prev);
        if (next.has(employee_id)) { next.delete(employee_id); next.add(value); }
        return next;
      });
    }
  };

  const handleAttendanceEdit = (employee_id, dateString, value, day) => {
    setDirtyRows(prev => new Set(prev).add(employee_id));
    setData(prevData => prevData.map(emp => {
      if (emp.employee_id === employee_id) {
        const newAttendance = [...(emp.attendance || [])];
        const index = newAttendance.findIndex(a => matchDate(a.date, dateString));
        if (index >= 0) {
          newAttendance[index] = { ...newAttendance[index], working_hours: value, day };
        } else {
          newAttendance.push({ date: dateString, working_hours: value, day });
        }
        return { ...emp, attendance: newAttendance };
      }
      return emp;
    }));
  };

  const handleSaveAll = async () => {
    if (dirtyRows.size === 0) return;
    try {
      setLoading(true);
      const rowsToSave = data.filter(d => dirtyRows.has(d.employee_id));
      for (const emp of rowsToSave) {
        const res = await fetch(`${BACKEND_URL}/api/po-data/save`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...emp, year, month })
        });
        if (!res.ok) throw new Error(`Failed to save ${emp.employee_name}`);
      }
      setDirtyRows(new Set());
      alert('All updates saved successfully!');
    } catch (err) {
      console.error(err);
      alert('Error saving updates: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleFinalizeAll = async () => {
    if (!window.confirm("Are you sure you want to finalize all visible records? This will lock them from being updated by future Excel uploads.")) return;

    setLoading(true);
    try {
      const rowsToSave = filteredData.filter(d => !d.is_finalized);
      for (const emp of rowsToSave) {
        const res = await fetch(`${BACKEND_URL}/api/po-data/save`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...emp, year, month, is_finalized: true })
        });
        if (!res.ok) throw new Error(`Failed to finalize ${emp.employee_name}`);
      }
      await fetchData();
      alert('All visible records have been finalized and locked!');
    } catch (err) {
      console.error(err);
      alert('Error finalizing records: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleFinalizeRow = async (emp) => {
    if (!window.confirm(`Are you sure you want to finalize records for ${emp.employee_name}?`)) return;

    setLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/po-data/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...emp, year, month, is_finalized: true })
      });
      if (!res.ok) throw new Error(`Failed to finalize ${emp.employee_name}`);
      await fetchData();
    } catch (err) {
      console.error(err);
      alert('Error finalizing record: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleUnlockRow = async (emp) => {
    if (!window.confirm(`Are you sure you want to unlock records for ${emp.employee_name}?`)) return;

    setLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/po-data/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...emp, year, month, is_finalized: false })
      });
      if (!res.ok) throw new Error(`Failed to unlock ${emp.employee_name}`);
      await fetchData();
    } catch (err) {
      console.error(err);
      alert('Error unlocking record: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [year, month]);

  const managers = useMemo(() => {
    const uniqueManagers = new Set(data.map(emp => emp.reporting_manager).filter(Boolean));
    return ['All', ...Array.from(uniqueManagers).sort()];
  }, [data]);

  const filteredData = useMemo(() => {
    let filtered = data;
    // Apply manager filter
    if (managerFilter !== 'All') {
      filtered = filtered.filter(emp => emp.reporting_manager === managerFilter);
    }
    // Apply status filter
    if (statusFilter === 'received') {
      filtered = filtered.filter(emp => !emp.is_finalized && emp.received_via_email);
    } else if (statusFilter === 'pending') {
      filtered = filtered.filter(emp => !emp.is_finalized && !emp.received_via_email);
    } else if (statusFilter === 'finalized') {
      filtered = filtered.filter(emp => emp.is_finalized);
    }
    return filtered;
  }, [data, managerFilter, statusFilter]);

  const receivedCount = useMemo(() => data.filter(e => !e.is_finalized && e.received_via_email).length, [data]);
  const pendingCount = useMemo(() => data.filter(e => !e.is_finalized && !e.received_via_email).length, [data]);
  const finalizedCount = useMemo(() => data.filter(e => e.is_finalized).length, [data]);

  // When data changes, default to all selected
  useEffect(() => {
    if (filteredData.length > 0) {
      setSelectedRows(new Set(filteredData.map(emp => emp.employee_id)));
    } else {
      setSelectedRows(new Set());
    }
  }, [filteredData]);

  const getExportData = () => {
    const monthName = new Date(year, month - 1).toLocaleString('default', { month: 'long' });
    const selectedData = data.filter(emp => selectedRows.has(emp.employee_id));

    return selectedData.map(emp => {
      const row = {
        'Employee Name': emp.employee_name,
        'Employee ID': emp.employee_id,
        'Joining Date': emp.joining_date || 'N/A',
        'Reporting Manager': emp.reporting_manager || 'N/A',
        'D&T Leader': emp.dt_leader || 'N/A',
        'Client': emp.client || 'N/A',
        'Billing Category': emp.billing_category || 'N/A',
        'Month': monthName
      };
      const totalHours = calculateTotalHours(emp.attendance);
      const monthPL = calculatePLAvailed(emp.attendance);
      const prevPL = emp.previous_pl_in_quarter || 0;
      const remainingQuota = Math.max(0, 3 - prevPL);
      const paidPL = Math.min(monthPL, remainingQuota);

      let exportQuota = remainingQuota;
      calendarColumns.forEach(col => {
        const isWeekend = col.day === 'Sat' || col.day === 'Sun';
        
        // Strict weekend logic: Sat/Sun are always WE, weekdays never WE
        if (isWeekend) {
          row[`${col.date}-${col.day}`] = 'WE';
          return;
        }
        
        const record = emp.attendance?.find(a => matchDate(a.date, col.fullDate));
        let val = record ? record.working_hours : '-';
        
        // If DB still has WE on a weekday (edge case), default to 8
        if (typeof val === 'string' && val.trim().toUpperCase() === 'WE') {
          val = 8;
        }
        
        if (typeof val === 'string' && val.trim().toUpperCase() === 'PL') {
          if (exportQuota > 0) {
            val = 'PL';
            exportQuota--;
          } else {
            val = 'LWP';
          }
        }
        row[`${col.date}-${col.day}`] = val;
      });

      const lwp = monthPL - paidPL;
      const totalBillingHours = totalHours + (paidPL * 8);

      row['Total Hours'] = totalHours.toFixed(1);
      row['PL Availed'] = paidPL || '-';
      row['LWP'] = lwp || '-';
      row['Total Billing hours'] = totalBillingHours.toFixed(1);

      return row;
    });
  };

  const applyExcelStyles = (worksheet, data) => {
    if (data.length === 0) return;

    // Define Columns
    const columns = Object.keys(data[0]).map(key => ({
      header: key,
      key: key,
      width: Math.max(key.length + 5, 12)
    }));
    worksheet.columns = columns;

    // Add Data Rows
    worksheet.addRows(data);

    // Styling the Header Row
    const headerRow = worksheet.getRow(1);
    headerRow.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF3C874B' } // Algoleap Green
      };
      cell.font = {
        color: { argb: 'FFFFFFFF' },
        bold: true,
        size: 11
      };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      };
    });
    headerRow.height = 25;

    // Styling Data Rows (Zebra Stripes, Alignment & Granular Alpha Highlighting)
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber > 1) {
        const isEven = rowNumber % 2 === 0;

        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          // 1. Base Alignment and Border (applied to all cells)
          cell.alignment = { vertical: 'middle', horizontal: 'center' };
          cell.border = {
            top: { style: 'thin', color: { argb: 'FFEEEEEE' } },
            left: { style: 'thin', color: { argb: 'FFEEEEEE' } },
            bottom: { style: 'thin', color: { argb: 'FFEEEEEE' } },
            right: { style: 'thin', color: { argb: 'FFEEEEEE' } }
          };

          // 2. Base Fill (Zebra Stripes)
          if (isEven) {
            cell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFF9FAFB' }
            };
          }

          // 3. Granular Alpha Highlighting (Only between Month (col 8) and Total Hours)
          if (colNumber > 8 && colNumber < row.cellCount - 4) {
            const val = cell.value;
            if (val !== '-' && isNaN(parseFloat(val))) {
              cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFE0E0E0' } // Highlight only this specific alpha cell
              };
            }
          }
        });
        row.height = 20;
      }
    });

    // Auto-size columns based on content
    worksheet.columns.forEach(column => {
      let maxColumnLength = 0;
      column.eachCell({ includeEmpty: true }, (cell) => {
        const currCellLen = cell.value ? cell.value.toString().length : 0;
        maxColumnLength = Math.max(maxColumnLength, currCellLen);
      });
      column.width = Math.max(column.width, maxColumnLength + 4);
    });
  };

  const downloadExcel = async () => {
    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Timesheet');
    const exportData = getExportData();
    const monthName = new Date(year, month - 1).toLocaleString('default', { month: 'long' });

    applyExcelStyles(worksheet, exportData);

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `Algoleap_Timesheet_${monthName}_${year}.xlsx`;
    anchor.click();
    window.URL.revokeObjectURL(url);
  };



  const handleDownloadEmployee = async (emp) => {
    try {
      setLoading(true);
      const url = `${BACKEND_URL}/api/download-timesheet?employee_id=${encodeURIComponent(emp.employee_id)}&year=${year}&month=${month}`;
      const res = await fetch(url);
      if (!res.ok) {
        const err = await res.json();
        alert(`Download failed: ${err.error || 'Unknown error'}`);
        return;
      }
      const blob = await res.blob();
      const shortMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const monthLabel = `${shortMonths[month - 1]}'${String(year).slice(2)}`;
      const filename = `Timesheet_${emp.employee_name}_${monthLabel}_Algoleap_CBRE-HYD.xlsx`;
      const link = document.createElement('a');
      link.href = window.URL.createObjectURL(blob);
      link.download = filename;
      link.click();
      window.URL.revokeObjectURL(link.href);
    } catch (err) {
      console.error('Download error:', err);
      alert('Error downloading employee timesheet.');
    } finally {
      setLoading(false);
    }
  };

  const calculateTotalHours = (attendance) => {
    if (!attendance) return 0;
    return attendance.reduce((acc, curr) => {
      const val = parseFloat(curr.working_hours);
      return acc + (isNaN(val) ? 0 : val);
    }, 0);
  };

  const calculatePLAvailed = (attendance) => {
    if (!attendance) return 0;
    return attendance.reduce((acc, curr) => {
      if (curr.working_hours && typeof curr.working_hours === 'string') {
        const val = curr.working_hours.trim().toUpperCase();
        if (val === 'PL') return acc + 1;
      }
      return acc;
    }, 0);
  };

  const calculateExplicitLWP = (attendance) => {
    if (!attendance) return 0;
    return attendance.reduce((acc, curr) => {
      if (curr.working_hours && typeof curr.working_hours === 'string') {
        const val = curr.working_hours.trim().toUpperCase();
        if (val === 'LWP') return acc + 1;
      }
      return acc;
    }, 0);
  };

  return (
    <section id="timesheet-section" className="section">
      <div className="section-title">TimeSheet</div>

      <div className="card">
        {/* Status Summary Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '1rem' }}>
          {[
            { key: 'received', label: 'Received', count: receivedCount, color: '#3b82f6', bgColor: '#eff6ff', icon: '📥', desc: 'Timesheet received & validated' },
            { key: 'pending', label: 'Pending', count: pendingCount, color: '#ef4444', bgColor: '#fee2e2', icon: '⏳', desc: 'No timesheet data yet' },
            { key: 'finalized', label: 'Finalized', count: finalizedCount, color: '#22c55e', bgColor: '#dcfce7', icon: '🔒', desc: 'Locked and processed' },
          ].map(tab => (
            <div
              key={tab.key}
              onClick={() => setStatusFilter(statusFilter === tab.key ? 'all' : tab.key)}
              style={{
                padding: '1rem',
                borderRadius: '12px',
                border: statusFilter === tab.key ? `2px solid ${tab.color}` : '2px solid transparent',
                background: tab.bgColor,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                transform: statusFilter === tab.key ? 'scale(1.02)' : 'scale(1)',
                boxShadow: statusFilter === tab.key ? `0 4px 12px ${tab.color}33` : 'none',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: '600', color: '#374151' }}>{tab.icon} {tab.label}</span>
                <span style={{ fontSize: '1.5rem', fontWeight: '800', color: tab.color }}>{tab.count}</span>
              </div>
              <div style={{ fontSize: '0.7rem', color: '#6b7280', marginTop: '0.2rem' }}>{tab.desc}</div>
            </div>
          ))}
        </div>

        <div className="controls-header">
          <div className="filters-group">
            <select
              className="select-input"
              value={month}
              onChange={(e) => setMonth(parseInt(e.target.value))}
            >
              {[...Array(12)].map((_, i) => (
                <option key={i + 1} value={i + 1}>
                  {new Date(0, i).toLocaleString('default', { month: 'long' })}
                </option>
              ))}
            </select>
            <select
              className="select-input"
              value={year}
              onChange={(e) => setYear(parseInt(e.target.value))}
            >
              {(() => { const cy = new Date().getFullYear(); return [cy - 2, cy - 1, cy, cy + 1]; })().map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            <select
              className="select-input"
              value={managerFilter}
              onChange={(e) => setManagerFilter(e.target.value)}
            >
              {managers.map(m => (
                <option key={m} value={m}>{m === 'All' ? 'All Managers' : m}</option>
              ))}
            </select>
          </div>
          {dirtyRows.size > 0 && (
            <span style={{ color: '#d97706', fontWeight: 'bold', marginRight: 'auto', marginLeft: '1rem', display: 'flex', alignItems: 'center' }}>
              ⚠️ You have unsaved changes
            </span>
          )}
          <button className="btn btn-primary" onClick={handleSaveAll} disabled={loading || dirtyRows.size === 0} style={{ marginRight: '1rem', marginLeft: dirtyRows.size === 0 ? 'auto' : '0' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '0.5rem' }}><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
            Save All
          </button>
          <button className="btn btn-secondary" onClick={handleFinalizeAll} disabled={loading || filteredData.every(d => d.is_finalized)} style={{ marginRight: '1rem', background: '#eab308', color: 'white', border: 'none' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '0.5rem' }}><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
            Finalize All
          </button>
          <button className="btn btn-primary" onClick={downloadExcel} disabled={loading}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
            Download Sheet
          </button>
        </div>



        <div className="table-container">
          <table id="po-table">
            <thead>
              <tr>
                <th rowSpan="2" className="sticky-column col-checkbox">
                  <input
                    type="checkbox"
                    checked={filteredData.length > 0 && selectedRows.size === filteredData.length}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedRows(new Set(filteredData.map(emp => emp.employee_id)));
                      } else {
                        setSelectedRows(new Set());
                      }
                    }}
                  />
                </th>
                <th rowSpan="2" className="sticky-column" style={{ left: '40px', minWidth: '90px' }}>Finalized</th>
                <th rowSpan="2" className="sticky-column col-sno" style={{ left: '130px' }}>S.No</th>
                <th rowSpan="2" className="sticky-column col-name" style={{ left: '180px' }}>Employee Name</th>
                <th rowSpan="2" className="sticky-column col-id" style={{ left: '380px' }}>Employee ID</th>
                <th rowSpan="2">Joining Date</th>
                <th rowSpan="2">Reporting Manager</th>
                <th rowSpan="2">D&T Leader</th>
                <th rowSpan="2">Client</th>
                <th rowSpan="2">Billing Category</th>
                <th rowSpan="2">Month</th>
                {calendarColumns.map(col => (
                  <th key={col.date}>{col.date}-{new Date(year, month - 1).toLocaleString('default', { month: 'short' })}</th>
                ))}
                <th rowSpan="2">Total Working Hours</th>
                <th rowSpan="2">PL Availed</th>
                <th rowSpan="2">LWP</th>
                <th rowSpan="2">Total Billing hours</th>
                <th rowSpan="2">Download</th>
                <th rowSpan="2">Actions</th>
              </tr>
              <tr>
                {calendarColumns.map(col => (
                  <th key={col.date} style={{ backgroundColor: (col.day === 'Sat' || col.day === 'Sun') ? 'var(--border)' : '#f1f5f9' }}>
                    {col.day}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={calendarColumns.length + 15} style={{ textAlign: 'center', padding: '3rem' }}>Loading data...</td></tr>
              ) : filteredData.length === 0 ? (
                <tr><td colSpan={calendarColumns.length + 15} style={{ textAlign: 'center', padding: '3rem' }}>No data found for this period.</td></tr>
              ) : filteredData.map((emp, idx) => {
                const totalHours = calculateTotalHours(emp.attendance);
                const monthPL = calculatePLAvailed(emp.attendance);
                const explicitLWP = calculateExplicitLWP(emp.attendance);
                const prevPL = emp.previous_pl_in_quarter || 0;
                const remainingQuota = Math.max(0, 3 - prevPL);
                const paidPL = Math.min(monthPL, remainingQuota);
                const lwpFromQuota = monthPL - paidPL;
                const lwp = lwpFromQuota + explicitLWP;
                const totalBillingHours = totalHours + (paidPL * 8);

                let renderQuota = remainingQuota;
                return (
                  <tr key={emp.employee_id} style={{ backgroundColor: emp.is_finalized ? '#f0fdf4' : 'inherit' }}>
                    <td className="sticky-column col-checkbox" style={{ backgroundColor: emp.is_finalized ? '#f0fdf4' : undefined }}>
                      <input
                        type="checkbox"
                        checked={selectedRows.has(emp.employee_id)}
                        onChange={(e) => {
                          const newSelected = new Set(selectedRows);
                          if (e.target.checked) {
                            newSelected.add(emp.employee_id);
                          } else {
                            newSelected.delete(emp.employee_id);
                          }
                          setSelectedRows(newSelected);
                        }}
                      />
                    </td>
                    <td className="sticky-column" style={{ left: '40px', minWidth: '90px', textAlign: 'center', backgroundColor: emp.is_finalized ? '#f0fdf4' : undefined }}>
                      {emp.is_finalized ? (
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', background: '#3b82f6', color: 'white', border: 'none' }}
                          onClick={() => handleUnlockRow(emp)}
                          disabled={loading}
                        >
                          Edit
                        </button>
                      ) : (
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '0.2rem 0.5rem', fontSize: '0.75rem', background: '#eab308', color: 'white', border: 'none' }}
                          onClick={() => handleFinalizeRow(emp)}
                          disabled={loading}
                        >
                          Finalize
                        </button>
                      )}
                    </td>
                    <td className="sticky-column col-sno" style={{ left: '130px', fontWeight: '600', color: 'var(--text-muted)', backgroundColor: emp.is_finalized ? '#f0fdf4' : undefined }}>{idx + 1}</td>
                    <td className="sticky-column col-name" style={{ left: '180px', backgroundColor: emp.is_finalized ? '#f0fdf4' : undefined }}>{emp.employee_name}</td>
                    <td className="sticky-column col-id" style={{ left: '380px', backgroundColor: emp.is_finalized ? '#f0fdf4' : undefined }}>{emp.employee_id}</td>
                    <td>{formatDisplayDate(emp.joining_date)}</td>
                    <td>{emp.reporting_manager}</td>
                    <td>{emp.dt_leader}</td>
                    <td>{emp.client || 'CBRE'}</td>
                    <td>{emp.billing_category || 'No'}</td>
                    <td>{new Date(year, month - 1).toLocaleString('default', { month: 'long' })}</td>
                    {calendarColumns.map(col => {
                      const record = emp.attendance?.find(a => matchDate(a.date, col.fullDate));
                      let displayVal = record ? record.working_hours : '-';

                      const isWeekend = col.day === 'Sat' || col.day === 'Sun';

                      // Auto-correct display values based on actual calendar days
                      if (isWeekend) {
                        displayVal = 'WE';
                      } else if (displayVal === 'WE') {
                        // If DB still has WE for a weekday (edge case), default to 8
                        displayVal = 8;
                      }

                      if (typeof displayVal === 'string' && displayVal.trim().toUpperCase() === 'PL') {
                        if (renderQuota > 0) {
                          displayVal = 'PL';
                          renderQuota--;
                        } else {
                          displayVal = 'LWP';
                        }
                      }

                      let bgColor = 'transparent';
                      let fontColor = 'inherit';
                      let fontWeight = 'normal';

                      if (isWeekend) {
                        bgColor = 'var(--border)'; // Gray out weekends
                        fontWeight = 'bold';
                      } else if (displayVal === 'PH') {
                        bgColor = '#dcfce7';
                        fontColor = '#166534';
                        fontWeight = 'bold';
                      } else if (displayVal === 'PL') {
                        fontColor = '#ef4444';
                        fontWeight = 'bold';
                      } else if (displayVal === 'LWP') {
                        fontColor = '#ef4444';
                        fontWeight = 'bold';
                      }

                      return (
                        <td
                          key={col.date}
                          contentEditable={!isWeekend && !emp.is_finalized}
                          suppressContentEditableWarning
                          style={{ backgroundColor: bgColor, color: fontColor, fontWeight }}
                          onBlur={(e) => {
                            if (!isWeekend && e.target.innerText !== displayVal) {
                              handleAttendanceEdit(emp.employee_id, col.fullDate, e.target.innerText, col.day);
                            }
                          }}
                        >
                          {displayVal}
                        </td>
                      );
                    })}
                    <td style={{ fontWeight: 'bold' }}>{totalHours.toFixed(1)}</td>
                    <td style={{ fontWeight: 'bold', color: 'var(--primary)' }} title={`Total PLs marked this month: ${monthPL}, Previously taken in quarter: ${prevPL}`}>{paidPL || '-'}</td>
                    <td style={{ fontWeight: 'bold', color: '#ef4444' }}>{lwp || '-'}</td>
                    <td style={{ fontWeight: 'bold', color: 'var(--primary)' }}>{totalBillingHours.toFixed(1)}</td>

                    <td>
                      <button onClick={() => handleDownloadEmployee(emp)} style={{ background: 'transparent', border: 'none', color: '#2563eb', cursor: 'pointer', padding: '0.25rem' }} title={`Download Timesheet for ${emp.employee_name}`}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                      </button>
                    </td>
                    <td>
                      <button onClick={() => handleDeleteRow(emp)} style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '0.25rem' }} title="Delete Row">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function POSheetSection() {
  const getDefaultDate = () => {
    const now = new Date();
    const day = now.getDate();
    let m = now.getMonth() + 1;
    let y = now.getFullYear();
    if (day <= 19) {
      m -= 1;
      if (m === 0) {
        m = 12;
        y -= 1;
      }
    }
    return { month: m, year: y };
  };
  const initDate = getDefaultDate();

  const [year, setYear] = useState(initDate.year);
  const [month, setMonth] = useState(initDate.month);
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [dirtyRows, setDirtyRows] = useState(new Set());

  const monthName = (m, y) => new Date(y, m - 1).toLocaleString('default', { month: 'short' }) + `'${String(y).slice(2)}`;

  const quarterMonths = useMemo(() => {
    const s = month <= 3 ? 1 : month <= 6 ? 4 : month <= 9 ? 7 : 10;
    return [s, s + 1, s + 2];
  }, [month]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/po-sheet?year=${year}&month=${month}`);
      const json = await res.json();
      setData(json || []);
    } catch (err) { console.error('PO Sheet fetch error:', err); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, [year, month]);

  const handleEdit = (employee_id, field, value) => {
    setDirtyRows(prev => new Set(prev).add(employee_id));
    setData(prev => prev.map(r => r.employee_id === employee_id ? { ...r, [field]: value } : r));
  };

  const handleSaveAll = async () => {
    if (dirtyRows.size === 0) return;
    setLoading(true);
    try {
      const rowsToSave = data.filter(d => dirtyRows.has(d.employee_id));
      for (const row of rowsToSave) {
        const res = await fetch(`${BACKEND_URL}/api/po-sheet/save`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...row, year, month })
        });
        if (!res.ok) {
          const e = await res.json();
          throw new Error(e.error || 'Unknown error');
        }
      }
      setDirtyRows(new Set());
      alert('All PO Sheet updates saved successfully!');
    } catch (err) {
      alert(`Error saving updates: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const downloadPOSheet = async () => {
    const ExcelJS = require('exceljs');
    const mName = new Date(year, month - 1).toLocaleString('default', { month: 'long' });
    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet('PO Sheet');
    const qMonthNames = quarterMonths.map(m => monthName(m, year));

    const headers = [
      'S.No', 'Resource Name', 'Emp ID (CBRE)', 'Invoice No', 'PO Number', 'SOW No',
      'Reporting Manager', 'D&T Leader', 'Total Working Hours', 'PL Availed',
      'Total Billing Hours', 'Rate Per Hour (INR)', 'Total Billing Amt (W/O GST)',
      'Timesheet Sent to CBRE',
      `${qMonthNames[0]} Leaves`, `${qMonthNames[1]} Leaves`, `${qMonthNames[2]} Leaves`,
      'Q Leave Balance', `${monthName(month, year)} Leave Dates`,
      'Notes', 'Work Location', 'Resource Type', 'Vendor Name', 'Exits'
    ];
    ws.columns = headers.map(h => ({ header: h, key: h, width: Math.max(h.length + 4, 14) }));

    data.forEach(row => {
      const rph = parseFloat(row.rate_per_hour) || 0;
      const gstPct = (row.gst !== '' && row.gst !== null && row.gst !== undefined) ? parseFloat(row.gst) : 18;
      const billingNoGST = row.total_billing_hours * rph;
      const gstAmt = billingNoGST * gstPct / 100;
      const totalBilled = billingNoGST + gstAmt;
      const qLeaves = row.quarter_leaves || [0, 0, 0];
      const entry = {
        'S.No': row.sno,
        'Resource Name': row.employee_name,
        'Emp ID (CBRE)': row.employee_id,
        'Invoice No': row.invoice_no || '',
        'PO Number': row.po_number || '',
        'SOW No': row.sow_no || '',
        'Reporting Manager': row.reporting_manager || '',
        'D&T Leader': row.dt_leader || '',
        'Total Working Hours': row.total_hours,
        'PL Availed': row.pl_availed,
        'Total Billing Hours': row.total_billing_hours,
        'Rate Per Hour (INR)': rph,
        'Total Billing Amt (W/O GST)': billingNoGST,
        'GST (%)': gstPct,
        'Total Billed Amount': totalBilled,
        'Timesheet Received': row.timesheet_received || '',
        'Timesheet Verified': row.timesheet_verified || '',
        'Timesheet Sent to CBRE': row.timesheet_sent_to_cbre || '',

        'Q Leave Balance': row.q_leave_balance,
        [`${monthName(month, year)} Leave Dates`]: row.pl_dates || '-',
        'Notes': row.notes || '',
        'Work Location': row.work_location || '',
        'Resource Type': row.resource_type || '',
        'Vendor Name': row.vendor_name || 'Algoleap',
        'Exits': row.exits || ''
      };
      entry[`${qMonthNames[0]} Leaves`] = qLeaves[0] || 0;
      entry[`${qMonthNames[1]} Leaves`] = qLeaves[1] || 0;
      entry[`${qMonthNames[2]} Leaves`] = qLeaves[2] || 0;
      ws.addRow(entry);
    });

    // Style header
    const headerRow = ws.getRow(1);
    headerRow.eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3C874B' } };
      cell.font = { color: { argb: 'FFFFFFFF' }, bold: true, size: 11 };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
    });
    headerRow.height = 30;
    ws.eachRow((row, rowNum) => {
      if (rowNum > 1) {
        row.eachCell({ includeEmpty: true }, cell => {
          cell.alignment = { vertical: 'middle', horizontal: 'center' };
          cell.border = { top: { style: 'thin', color: { argb: 'FFEEEEEE' } }, left: { style: 'thin', color: { argb: 'FFEEEEEE' } }, bottom: { style: 'thin', color: { argb: 'FFEEEEEE' } }, right: { style: 'thin', color: { argb: 'FFEEEEEE' } } };
          if (rowNum % 2 === 0) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } };
        });
        row.height = 20;
      }
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `Algoleap_POSheet_${mName}_${year}.xlsx`;
    anchor.click();
    window.URL.revokeObjectURL(url);
  };

  const yesNoCell = (row, field) => (
    <select value={row[field] || ''} onChange={e => handleEdit(row.employee_id, field, e.target.value)}
      style={{ padding: '0.2rem 0.3rem', border: '1px solid var(--border)', borderRadius: '4px', fontSize: '0.8rem', minWidth: '72px' }}>
      <option value=''>-</option>
      <option value='Yes'>Yes</option>
      <option value='No'>No</option>
    </select>
  );

  const editCell = (row, field, placeholder = '') => (
    <td contentEditable suppressContentEditableWarning
      onBlur={e => handleEdit(row.employee_id, field, e.target.innerText)}
      style={{ minWidth: '90px' }}>
      {row[field] || placeholder}
    </td>
  );

  const fmt = (v) => v ? Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-';

  return (
    <section id="po-sheet-section" className="section">
      <div className="section-title">PO Sheet</div>
      <div className="card">
        <div className="controls-header">
          <div className="filters-group">
            <select className="select-input" value={month} onChange={e => setMonth(parseInt(e.target.value))}>
              {[...Array(12)].map((_, i) => (
                <option key={i + 1} value={i + 1}>{new Date(0, i).toLocaleString('default', { month: 'long' })}</option>
              ))}
            </select>
            <select className="select-input" value={year} onChange={e => setYear(parseInt(e.target.value))}>
              {(() => { const cy = new Date().getFullYear(); return [cy - 2, cy - 1, cy, cy + 1]; })().map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          {dirtyRows.size > 0 && (
            <span style={{ color: '#d97706', fontWeight: 'bold', marginRight: 'auto', marginLeft: '1rem', display: 'flex', alignItems: 'center' }}>
              ⚠️ You have unsaved changes
            </span>
          )}
          <button className="btn btn-primary" onClick={handleSaveAll} disabled={loading || dirtyRows.size === 0} style={{ marginRight: '1rem', marginLeft: dirtyRows.size === 0 ? 'auto' : '0' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '0.5rem' }}><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
            Save All
          </button>
          <button className="btn btn-primary" onClick={downloadPOSheet} disabled={loading}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '0.5rem' }}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
            Download Sheet
          </button>
        </div>

        <div className="table-container">
          <table id="po-sheet-table">
            <thead>
              <tr>
                <th className="sticky-column col-sno">S.No</th>
                <th className="sticky-column col-name">Resource Name</th>
                <th className="sticky-column col-id">Emp ID (CBRE)</th>
                <th>Invoice No</th>
                <th>PO Number</th>
                <th>SOW No</th>
                <th>Reporting Manager</th>
                <th>D&T Leader</th>
                <th>Total Working Hours</th>
                <th>PL Availed</th>
                <th>Total Billing Hours</th>
                <th>Rate Per Hour (INR)</th>
                <th>Total Billing Amt (W/O GST)</th>
                <th>GST (%)</th>
                <th>Total Billed Amount</th>
                <th>Timesheet Received</th>
                <th>Timesheet Verified</th>
                <th>Timesheet Sent to CBRE</th>

                {quarterMonths.map(m => <th key={m}>{monthName(m, year)} Leaves</th>)}
                <th>Q Leave Balance</th>
                <th>{monthName(month, year)} Leave Dates</th>
                <th>Notes</th>
                <th>Work Location</th>
                <th>Resource Type</th>
                <th>Vendor Name</th>
                <th>Exits</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={30} style={{ textAlign: 'center', padding: '3rem' }}>Loading...</td></tr>
              ) : data.length === 0 ? (
                <tr><td colSpan={30} style={{ textAlign: 'center', padding: '3rem' }}>No data for this period.</td></tr>
              ) : data.map(row => {
                const rph = parseFloat(row.rate_per_hour) || 0;
                const gstPct = (row.gst !== '' && row.gst !== null && row.gst !== undefined) ? parseFloat(row.gst) : 18;
                const billingNoGST = row.total_billing_hours * rph;
                const gstAmt = billingNoGST * gstPct / 100;
                const totalBilled = billingNoGST + gstAmt;
                return (
                  <tr key={row.employee_id}>
                    <td className="sticky-column col-sno" style={{ textAlign: 'center' }}>{row.sno}</td>
                    <td className="sticky-column col-name" style={{ fontWeight: '600' }}>{row.employee_name}</td>
                    <td className="sticky-column col-id" style={{ fontSize: '0.8rem' }}>{row.employee_id}</td>
                    {editCell(row, 'invoice_no')}
                    {editCell(row, 'po_number')}
                    {editCell(row, 'sow_no')}
                    <td>{row.reporting_manager || '-'}</td>
                    <td>{row.dt_leader || '-'}</td>
                    <td style={{ fontWeight: 'bold' }}>{row.total_hours?.toFixed(1)}</td>
                    <td style={{ fontWeight: 'bold', color: 'var(--primary)' }}>{row.pl_availed || '-'}</td>
                    <td style={{ fontWeight: 'bold', color: 'var(--primary)' }}>{row.total_billing_hours?.toFixed(1)}</td>
                    {editCell(row, 'rate_per_hour', '0')}
                    <td style={{ fontWeight: 'bold' }}>₹{fmt(billingNoGST)}</td>
                    {editCell(row, 'gst', '18')}
                    <td style={{ fontWeight: 'bold', color: '#22c55e' }}>₹{fmt(totalBilled)}</td>
                    <td>{yesNoCell(row, 'timesheet_received')}</td>
                    <td>{yesNoCell(row, 'timesheet_verified')}</td>
                    <td>{yesNoCell(row, 'timesheet_sent_to_cbre')}</td>

                    {(row.quarter_leaves || []).map((l, i) => <td key={i} style={{ textAlign: 'center' }}>{l || '-'}</td>)}
                    <td style={{ textAlign: 'center', fontWeight: 'bold', color: row.q_leave_balance === 0 ? '#ef4444' : 'var(--primary)' }}>{row.q_leave_balance}</td>
                    <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{row.pl_dates || '-'}</td>
                    {editCell(row, 'notes')}
                    {editCell(row, 'work_location')}
                    {editCell(row, 'resource_type')}
                    {editCell(row, 'vendor_name')}
                    {editCell(row, 'exits')}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function EmployeeDetailsSection() {
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(false);
  const [dirtyRows, setDirtyRows] = useState(new Set());

  const fetchEmployees = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/employees`);
      if (!res.ok) throw new Error(`Server returned ${res.status}: ${res.statusText}`);
      const json = await res.json();
      setEmployees(json || []);
    } catch (err) {
      console.error("Failed to fetch employees:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEmployees();
  }, []);

  const formatDisplayDate = (dateStr) => {
    if (!dateStr) return '';
    if (dateStr.includes('T')) return dateStr.split('T')[0];
    return dateStr;
  };

  const handleEdit = (id, field, value) => {
    setDirtyRows(prev => new Set(prev).add(id));
    setEmployees(prev => prev.map(emp =>
      emp.employee_id === id ? { ...emp, [field]: value } : emp
    ));
  };

  const handleSaveRow = async (emp) => {
    try {
      setLoading(true);
      const res = await fetch(`${BACKEND_URL}/api/po-data/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(emp)
      });
      if (!res.ok) throw new Error(`Failed to save ${emp.employee_name}`);
      
      setDirtyRows(prev => {
        const next = new Set(prev);
        next.delete(emp.employee_id);
        return next;
      });
      
      alert(`${emp.employee_name} saved successfully!`);
      fetchEmployees(); // Refresh to update IDs and remove NEW- markers
    } catch (err) {
      console.error("Error saving row:", err);
      alert("Error saving: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveAll = async () => {
    if (dirtyRows.size === 0) return;
    try {
      setLoading(true);
      const rowsToSave = employees.filter(emp => dirtyRows.has(emp.employee_id));
      for (const emp of rowsToSave) {
        const res = await fetch(`${BACKEND_URL}/api/po-data/save`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(emp)
        });
        if (!res.ok) throw new Error(`Failed to save ${emp.employee_name}`);
      }
      setDirtyRows(new Set());
      alert("All employee details saved successfully!");
      fetchEmployees();
    } catch (err) {
      console.error("Error saving employee:", err);
      alert("Error saving updates: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteEmployee = async (emp) => {
    const isNew = emp.employee_id.startsWith('NEW-');
    const confirmed = window.confirm(
      isNew
        ? `Remove unsaved row "${emp.employee_name}"?`
        : `Are you sure you want to permanently delete "${emp.employee_name}" and all their records from the database?`
    );
    if (!confirmed) return;

    if (!isNew) {
      try {
        setLoading(true);
        const res = await fetch(`${BACKEND_URL}/api/po-data/${encodeURIComponent(emp.employee_id)}`, { method: 'DELETE' });
        if (!res.ok) {
          const err = await res.json();
          alert(`Failed to delete: ${err.error || 'Unknown error'}`);
          return;
        }
      } catch {
        alert('Error deleting employee.');
        return;
      } finally {
        setLoading(false);
      }
    }

    setEmployees(prev => prev.filter(e => e.employee_id !== emp.employee_id));
  };

  const addEmployee = () => {
    const newId = 'NEW-' + Date.now();
    setEmployees([{
      employee_id: newId,
      employee_name: 'New Employee',
      email: '',
      dt_leader: '',
      reporting_manager: '',
      client: 'CBRE',
      billing_category: 'No'
    }, ...employees]);
  };

  return (
    <section id="employee-details" className="section">
      <div className="section-title">
        Employee Details
      </div>
      <div className="card">
        <div className="controls-header">
          <div></div>
          {dirtyRows.size > 0 && (
            <span style={{ color: '#d97706', fontWeight: 'bold', marginRight: 'auto', marginLeft: '1rem', display: 'flex', alignItems: 'center' }}>
              ⚠️ You have unsaved changes
            </span>
          )}
          <button className="btn btn-secondary" onClick={addEmployee} style={{ marginRight: '1rem', marginLeft: dirtyRows.size === 0 ? 'auto' : '0', background: '#e5e7eb', color: '#374151' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '0.5rem' }}><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            Add Employee
          </button>
          <button className="btn btn-primary" onClick={handleSaveAll} disabled={loading || dirtyRows.size === 0}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '0.5rem' }}><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
            Save All
          </button>
        </div>
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>S.No</th>
                <th>Name</th>
                <th>CBRE EMP ID</th>
                <th>Joining Date</th>
                <th>Email</th>
                <th>D&T Leader</th>
                <th>Reporting Manager</th>
                <th>Client</th>
                <th>Billing Category</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="9" style={{ textAlign: 'center', padding: '2rem' }}>Loading...</td></tr>
              ) : employees.length === 0 ? (
                <tr><td colSpan="9" style={{ textAlign: 'center', padding: '2rem' }}>No employee records found.</td></tr>
              ) : employees.map((emp, idx) => (
                <tr key={emp.employee_id}>
                  <td>{idx + 1}</td>
                  <td
                    contentEditable={emp.employee_id.startsWith('NEW-')}
                    suppressContentEditableWarning
                    onBlur={e => emp.employee_id.startsWith('NEW-') && handleEdit(emp.employee_id, 'employee_name', e.target.innerText)}
                    style={emp.employee_id.startsWith('NEW-') ? { outline: '1px dashed var(--primary)', cursor: 'text' } : {}}
                  >
                    {emp.employee_name}
                  </td>
                  <td
                    contentEditable={emp.employee_id.startsWith('NEW-')}
                    suppressContentEditableWarning
                    onBlur={e => emp.employee_id.startsWith('NEW-') && handleEdit(emp.employee_id, 'employee_id', e.target.innerText.trim())}
                    style={emp.employee_id.startsWith('NEW-') ? { outline: '1px dashed var(--primary)', cursor: 'text' } : {}}
                  >
                    {emp.employee_id}
                  </td>
                  <td>
                    <input
                      type="date"
                      value={formatDisplayDate(emp.joining_date)}
                      onChange={e => handleEdit(emp.employee_id, 'joining_date', e.target.value)}
                      className="select-input"
                      style={{ padding: '0.2rem', fontSize: '0.8rem', border: '1px solid var(--border)', borderRadius: '4px', background: 'transparent' }}
                    />
                  </td>
                  <td
                    contentEditable={emp.employee_id.startsWith('NEW-')}
                    suppressContentEditableWarning
                    onBlur={e => emp.employee_id.startsWith('NEW-') && handleEdit(emp.employee_id, 'email', e.target.innerText)}
                    style={emp.employee_id.startsWith('NEW-') ? { outline: '1px dashed var(--primary)', cursor: 'text' } : {}}
                  >
                    {emp.email || '-'}
                  </td>
                  <td contentEditable suppressContentEditableWarning onBlur={e => handleEdit(emp.employee_id, 'dt_leader', e.target.innerText)}>
                    {emp.dt_leader || '-'}
                  </td>
                  <td contentEditable suppressContentEditableWarning onBlur={e => handleEdit(emp.employee_id, 'reporting_manager', e.target.innerText)}>
                    {emp.reporting_manager || '-'}
                  </td>
                  <td>{emp.client || 'CBRE'}</td>
                  <td>
                    <select
                      className="select-input"
                      value={emp.billing_category || 'No'}
                      onChange={e => handleEdit(emp.employee_id, 'billing_category', e.target.value)}
                      style={{ padding: '0.25rem', fontSize: '0.8rem' }}
                    >
                      <option value="Yes">Yes</option>
                      <option value="No">No</option>
                    </select>
                  </td>
                  <td style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
                    {(dirtyRows.has(emp.employee_id) || emp.employee_id.startsWith('NEW-')) && (
                      <button 
                        onClick={() => handleSaveRow(emp)} 
                        style={{ background: 'transparent', border: 'none', color: '#22c55e', cursor: 'pointer', padding: '0.25rem' }} 
                        title="Save Changes"
                        disabled={loading}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
                      </button>
                    )}
                    <button onClick={() => handleDeleteEmployee(emp)} style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '0.25rem' }} title="Delete Employee">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function AutomationLogs() {
  const [logs, setLogs] = useState([]);
  const [status, setStatus] = useState('offline');
  const [loading, setLoading] = useState(false);

  const fetchStatus = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/health`);
      if (res.ok) setStatus('online');
      else setStatus('offline');
    } catch {
      setStatus('offline');
    }
  };

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/logs`);
      if (!res.ok) throw new Error(`Server returned ${res.status}: ${res.statusText}`);
      const json = await res.json();
      setLogs(json || []);
    } catch {
      console.error("Failed to fetch logs");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    fetchLogs();
    const interval = setInterval(() => {
      fetchStatus();
      fetchLogs();
    }, 10000); // Poll every 10s
    return () => clearInterval(interval);
  }, []);

  return (
    <section id="automation-logs" className="section">
      <div className="section-title">
        Automation Logs
        <span className={`badge ${status === 'online' ? 'badge-success' : 'badge-error'}`} style={{ marginLeft: '1rem' }}>
          {status}
        </span>
      </div>

      <div className="card">
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>File Name</th>
                <th>Status</th>
                <th>Created At</th>
              </tr>
            </thead>
            <tbody>
              {loading && logs.length === 0 ? (
                <tr><td colSpan="4" style={{ textAlign: 'center' }}>Loading logs...</td></tr>
              ) : logs.length === 0 ? (
                <tr><td colSpan="4" style={{ textAlign: 'center' }}>No logs available.</td></tr>
              ) : logs.map(log => (
                <tr key={log.id}>
                  <td style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{log.id}</td>
                  <td>{log.extracted_timesheet_filename}</td>
                  <td>
                    <span className={`badge ${log.status === 'completed' ? 'badge-success' :
                      log.status === 'pending' ? 'badge-warning' :
                        log.status === 'processing' ? 'badge-info' : 'badge-error'
                      }`}>
                      {log.status}
                    </span>
                  </td>
                  <td>{log.created_at ? new Date(log.created_at).toLocaleString() : 'N/A'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

    </section>
  );
}
