'use client';

import React from 'react';
import { ALL_PROBLEM_OPTIONS, normalizeProblemLabel } from '@/lib/afor-utils';

// ── Shared style constants (mirrors IncidentForm internals) ───────────────────
export const INPUT_CLS = 'w-full border border-gray-300 rounded p-2 text-gray-900 font-medium text-sm';
export const LABEL_CLS = 'block text-sm font-bold text-gray-900 mb-1';

// ── Constants ─────────────────────────────────────────────────────────────────

export const VEHICLE_ROWS = [
  { key: 'resources_bfp_trucks', label: 'BFP Fire Trucks' },
  { key: 'resources_lgu_trucks', label: 'BFP Manned Fire Trucks (LGU)' },
  { key: 'resources_non_bfp_trucks', label: 'Non-BFP Fire Trucks' },
  { key: 'resources_bfp_ambulance', label: 'BFP Ambulance' },
  { key: 'resources_non_bfp_ambulance', label: 'Non-BFP Ambulance' },
  { key: 'resources_bfp_rescue', label: 'BFP Rescue Trucks' },
  { key: 'resources_non_bfp_rescue', label: 'Non-BFP Rescue Trucks' },
] as const;

export const TOOL_ROWS: { key: string; label: string; type: 'number' | 'text' }[] = [
  { key: 'tools_scba', label: 'SCBA', type: 'number' },
  { key: 'tools_rope', label: 'Rope', type: 'text' },
  { key: 'tools_ladder', label: 'Ladder', type: 'number' },
  { key: 'tools_hoseline', label: 'Hoseline', type: 'text' },
  { key: 'tools_hydraulic', label: 'Hydraulic Tools', type: 'number' },
];

export const ALARM_ROWS = [
  { key: 'alarm_foua', label: '1ST ALARM-FOUA' },
  { key: 'alarm_1st', label: '1ST ALARM' },
  { key: 'alarm_2nd', label: '2ND ALARM' },
  { key: 'alarm_3rd', label: '3RD ALARM' },
  { key: 'alarm_4th', label: '4TH ALARM' },
  { key: 'alarm_5th', label: '5TH ALARM' },
  { key: 'alarm_tf_alpha', label: 'TASK FORCE ALPHA' },
  { key: 'alarm_tf_bravo', label: 'TASK FORCE BRAVO' },
  { key: 'alarm_tf_charlie', label: 'TASK FORCE CHARLIE' },
  { key: 'alarm_tf_delta', label: 'TASK FORCE DELTA' },
  { key: 'alarm_general', label: 'GENERAL ALARM' },
  { key: 'alarm_fuc', label: 'FIRE UNDER CONTROL (FUC)' },
  { key: 'alarm_fo', label: 'FIRE OUT (FO)' },
];

export const CASUALTY_ROWS = [
  { key: 'injured_civilian', label: 'Injured Civilian' },
  { key: 'injured_firefighter', label: 'Injured BFP Firefighter' },
  { key: 'injured_auxiliary', label: 'Injured Fire Auxiliary' },
  { key: 'fatal_civilian', label: 'Civilian Fatality/ies' },
  { key: 'fatal_firefighter', label: 'BFP Firefighter Fatality/ies' },
  { key: 'fatal_auxiliary', label: 'Fire Auxiliary Fatality/ies' },
] as const;

export const POD_ROLES: { key: string; label: string; contactKey?: string }[] = [
  { key: 'pod_engine_commander', label: 'Engine Commander' },
  { key: 'pod_shift_in_charge', label: 'Shift-in-Charge' },
  { key: 'pod_nozzleman', label: 'Nozzleman' },
  { key: 'pod_lineman', label: 'Lineman' },
  { key: 'pod_engine_crew', label: 'Engine Crew' },
  { key: 'pod_driver', label: 'Driver / Pump Operator (DPO)' },
  { key: 'pod_safety_officer', label: 'Safety Officer in Charge', contactKey: 'pod_safety_officer_contact' },
  { key: 'pod_inv_name', label: 'Fire & Arson Investigator/s', contactKey: 'pod_inv_contact' },
];

// ── Types ──────────────────────────────────────────────────────────────────────
type FormState = Record<string, unknown>;
type ChangeHandler = React.ChangeEventHandler<HTMLInputElement | HTMLTextAreaElement>;

// ── C. Assets and Resources ───────────────────────────────────────────────────

interface AssetsResourcesSectionProps {
  formState: FormState;
  handleChange: ChangeHandler;
  inputCls?: string;
  labelCls?: string;
}

export function AssetsResourcesSection({
  formState,
  handleChange,
  inputCls = INPUT_CLS,
  labelCls = LABEL_CLS,
}: AssetsResourcesSectionProps) {
  return (
    <section className="space-y-4 border-b pb-6">
      <h3 className="font-bold text-lg text-red-900 border-l-4 border-red-800 pl-2">C. Assets and Resources</h3>

      <div>
        <p className="text-xs font-bold text-gray-600 uppercase mb-2">Response Vehicles</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {VEHICLE_ROWS.map(({ key, label }) => (
            <div key={key}>
              <label className="block text-xs font-bold text-gray-700 mb-1">{label}</label>
              <input type="number" name={key} min="0" className={inputCls} value={(formState[key] as string) ?? ''} onChange={handleChange} />
            </div>
          ))}
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1">Others (specify)</label>
            <input type="text" name="resources_others" className={inputCls} placeholder="e.g. Water tanker x1" value={(formState.resources_others as string) ?? ''} onChange={handleChange} />
          </div>
        </div>
      </div>

      <div>
        <p className="text-xs font-bold text-gray-600 uppercase mb-2 mt-3">Tools and Equipment</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {TOOL_ROWS.map(({ key, label, type }) => (
            <div key={key}>
              <label className="block text-xs font-bold text-gray-700 mb-1">{label}</label>
              <input type={type} name={key} min={type === 'number' ? '0' : undefined} className={inputCls} value={(formState[key] as string) ?? ''} onChange={handleChange} />
            </div>
          ))}
          <div>
            <label className="block text-xs font-bold text-gray-700 mb-1">Others (specify)</label>
            <input type="text" name="tools_others" className={inputCls} value={(formState.tools_others as string) ?? ''} onChange={handleChange} />
          </div>
        </div>
      </div>

      <div>
        <label className={labelCls}>Location and Distance of Nearest Serviceable Fire Hydrant</label>
        <input name="hydrant_location_distance" type="text" className={inputCls} placeholder="e.g. 150m from the scene, corner Rizal Ave." value={(formState.hydrant_location_distance as string) ?? ''} onChange={handleChange} />
      </div>
    </section>
  );
}

// ── D. Fire Alarm Level ───────────────────────────────────────────────────────

interface AlarmLevelSectionProps {
  formState: FormState;
  handleChange: ChangeHandler;
  handleRadioChange: (name: string, value: string) => void;
  labelCls?: string;
  inputCls?: string;
}

export function AlarmLevelSection({
  formState,
  handleChange,
  handleRadioChange,
  labelCls = LABEL_CLS,
  inputCls = INPUT_CLS,
}: AlarmLevelSectionProps) {
  return (
    <section className="space-y-4 border-b pb-6">
      <h3 className="font-bold text-lg text-red-900 border-l-4 border-red-800 pl-2">D. Fire Alarm Level</h3>
      <div className="overflow-x-auto">
        <table className="min-w-full text-xs border border-gray-300">
          <thead className="bg-gray-100">
            <tr>
              <th className="border px-3 py-2 text-left w-40">Alarm Level</th>
              <th className="border px-3 py-2 text-left">Date &amp; Time</th>
              <th className="border px-3 py-2 text-left">Incident / Ground Commander</th>
            </tr>
          </thead>
          <tbody>
            {ALARM_ROWS.map(({ key, label }) => (
              <tr key={key}>
                <td className="border px-3 py-1 font-semibold text-gray-700">{label}</td>
                <td className="border px-1 py-1">
                  <input
                    type="datetime-local"
                    name={key}
                    className="w-full border-0 bg-transparent text-gray-900 text-xs p-1 focus:outline-none focus:ring-1 focus:ring-red-300 rounded"
                    value={(formState[key] as string) ?? ''}
                    onChange={handleChange}
                  />
                </td>
                <td className="border px-1 py-1">
                  <input
                    type="text"
                    name={`${key}_commander`}
                    placeholder="Name (Ground/Incident Commander)"
                    className="w-full border-0 bg-transparent text-gray-900 text-xs p-1 focus:outline-none focus:ring-1 focus:ring-red-300 rounded"
                    value={(formState[`${key}_commander`] as string) ?? ''}
                    onChange={handleChange}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
        <div>
          <label className={labelCls}>Incident Command Post (ICP)</label>
          <div className="flex gap-4 mt-1">
            {['with', 'without'].map((v) => (
              <label key={v} className="flex items-center gap-2 text-sm capitalize">
                <input type="radio" name="icp_present" value={v} checked={(formState.icp_present as string) === v} onChange={() => handleRadioChange('icp_present', v)} className="h-4 w-4" />
                {v}
              </label>
            ))}
          </div>
        </div>
        {(formState.icp_present as string) === 'with' && (
          <div>
            <label className={labelCls}>Specify ICP Location</label>
            <input name="icp_location" type="text" className={inputCls} placeholder="e.g. Corner of Rizal and Mabini Sts." value={(formState.icp_location as string) ?? ''} onChange={handleChange} />
          </div>
        )}
      </div>
    </section>
  );
}

// ── E. Profile of Casualties ──────────────────────────────────────────────────

interface CasualtiesSectionProps {
  formState: FormState;
  handleChange: ChangeHandler;
}

export function CasualtiesSection({ formState, handleChange }: CasualtiesSectionProps) {
  return (
    <section className="space-y-4 border-b pb-6">
      <h3 className="font-bold text-lg text-red-900 border-l-4 border-red-800 pl-2">E. Profile of Casualties</h3>
      <table className="min-w-full text-xs border border-gray-300">
        <thead className="bg-gray-100">
          <tr>
            <th className="border px-3 py-2 text-left">Category</th>
            <th className="border px-3 py-2 text-center w-24">Male</th>
            <th className="border px-3 py-2 text-center w-24">Female</th>
          </tr>
        </thead>
        <tbody>
          {CASUALTY_ROWS.map(({ key, label }) => (
            <tr key={key}>
              <td className="border px-3 py-1 font-semibold text-gray-700">{label}</td>
              <td className="border px-1 py-1">
                <input type="number" name={`${key}_m`} min="0" className="w-full border-0 bg-transparent text-gray-900 text-xs p-1 focus:outline-none focus:ring-1 focus:ring-red-300 rounded" value={(formState[`${key}_m`] as string) ?? ''} onChange={handleChange} />
              </td>
              <td className="border px-1 py-1">
                <input type="number" name={`${key}_f`} min="0" className="w-full border-0 bg-transparent text-gray-900 text-xs p-1 focus:outline-none focus:ring-1 focus:ring-red-300 rounded" value={(formState[`${key}_f`] as string) ?? ''} onChange={handleChange} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// ── F. Personnel on Duty ──────────────────────────────────────────────────────

interface PersonnelOnDutySectionProps {
  formState: FormState;
  handleChange: ChangeHandler;
  inputCls?: string;
}

export function PersonnelOnDutySection({ formState, handleChange, inputCls = INPUT_CLS }: PersonnelOnDutySectionProps) {
  return (
    <section className="space-y-4 border-b pb-6">
      <h3 className="font-bold text-lg text-red-900 border-l-4 border-red-800 pl-2">F. Personnel On Duty</h3>
      <div className="space-y-3">
        {POD_ROLES.map(({ key, label, contactKey }) => (
          <div key={key} className="grid grid-cols-1 md:grid-cols-3 gap-2 items-end">
            <span className="text-sm font-semibold text-gray-700 md:col-span-1">{label}</span>
            <input
              type="text"
              name={key}
              placeholder="Rank / Name"
              className={`${inputCls} md:col-span-1`}
              value={(formState[key] as string) ?? ''}
              onChange={handleChange}
            />
            {contactKey ? (
              <input
                type="tel"
                name={contactKey}
                placeholder="Contact number"
                className={`${inputCls} md:col-span-1`}
                value={(formState[contactKey] as string) ?? ''}
                onChange={handleChange}
              />
            ) : (
              <div />
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

// ── I. Problems Encountered ───────────────────────────────────────────────────

interface ProblemsChecklistSectionProps {
  formState: { problems_encountered?: string[]; problems_others?: string } & FormState;
  setFormState: React.Dispatch<React.SetStateAction<Record<string, unknown>>>;
  handleChange: ChangeHandler;
  inputCls?: string;
}

export function ProblemsChecklistSection({
  formState,
  setFormState,
  handleChange,
  inputCls = INPUT_CLS,
}: ProblemsChecklistSectionProps) {
  const problemsEncountered = (formState.problems_encountered as string[]) || [];

  return (
    <section className="space-y-4 border-b pb-6">
      <h3 className="font-bold text-lg text-red-900 border-l-4 border-red-800 pl-2">I. Problems Encountered</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
        {ALL_PROBLEM_OPTIONS.map((prob, idx) => {
          const normalizedProb = normalizeProblemLabel(prob);
          const isChecked = problemsEncountered.some((p) => normalizeProblemLabel(p) === normalizedProb);
          const checkboxId = `problem-checkbox-${idx}`;
          const isOthers = normalizedProb === normalizeProblemLabel('Others');

          return (
            <label key={`${idx}-${prob}`} htmlFor={checkboxId} className="flex items-start gap-2 cursor-pointer">
              <input
                id={checkboxId}
                type="checkbox"
                className="mt-0.5 h-4 w-4 flex-shrink-0 cursor-pointer"
                checked={isChecked}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setFormState((prev) => {
                    const prevTyped = prev as typeof formState;
                    const current = (prevTyped.problems_encountered as string[]) || [];
                    let updated: string[];

                    if (checked) {
                      updated = current.some((p) => normalizeProblemLabel(p) === normalizedProb)
                        ? current
                        : [...current, prob];
                    } else {
                      updated = current.filter((p) => normalizeProblemLabel(p) !== normalizedProb);
                    }

                    if (!checked && isOthers) {
                      return { ...prev, problems_encountered: updated, problems_others: '' };
                    }
                    return { ...prev, problems_encountered: updated };
                  });
                }}
              />
              <span className="select-none">{prob}</span>
            </label>
          );
        })}
      </div>
      <div>
        <label className="block text-xs font-bold text-gray-900 mb-1">Others (specify, separate by comma)</label>
        <input
          type="text"
          name="problems_others"
          className={inputCls}
          placeholder="e.g. Flooding in access road, Low visibility due to fog"
          value={(formState.problems_others as string) || ''}
          onChange={handleChange}
          disabled={problemsEncountered.every((p) => normalizeProblemLabel(p) !== 'Others')}
        />
      </div>
    </section>
  );
}
