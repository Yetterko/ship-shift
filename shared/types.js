// JSDoc typedefs for the wire. No runtime code. docs/REBUILD.md section 5.4 is the source of truth.
// All times are server epoch ms; the client corrects with the `now` each message carries.

/** @typedef {'frontend'|'backend'|'database'|'integration'} Station */
/** @typedef {'spectator'|'player'|'judge'} Role */
/** @typedef {'working'|'break'|'called_back'} Phase */

/**
 * @typedef {object} FloorLine One per floor, in `building`.
 * @property {string} id @property {number} number @property {string} name
 * @property {number|null} plot 0-23, null = no building on the park
 * @property {'audience'|'showcase'} kind @property {'player'|'judge'} ownerRole
 * @property {'live'|'demo'} mode @property {string} model @property {string} modelLabel
 * @property {number} score @property {number} shipped @property {number} watchers @property {Phase} phase
 * @property {{cooking:number,onPass:number,waiting:number}} lights
 */

/**
 * @typedef {object} FloorSnapshot
 * @property {string} id @property {number} number @property {string} name @property {number|null} plot
 * @property {'audience'|'showcase'} kind @property {'player'|'judge'} ownerRole
 * @property {'live'|'demo'} mode @property {'real'|'short'} timings
 * @property {string} model @property {string} modelLabel @property {'house'} keySource
 * @property {{spentUsd:number,capUsd:number,blocked:boolean,canGoLive:boolean}} budget
 * @property {{gracePeriodMs:number,maxWorkMs:number,maxAgentsForBreak:number}} settings
 * @property {Phase} phase @property {number} phaseStartedAt @property {number} workStretchStartedAt
 * @property {boolean} breakEligible @property {number|null} mustBreakAt @property {boolean} mustBreak
 * @property {{graceEndsAt:number|null,firedAt:number|null}} callBack
 * @property {boolean} ownerAway @property {boolean} ownerConnected
 * @property {'no_key'|'no_slot'|'no_budget'|null} demoReason why a floor that wanted Live runs in Demo; null once Live
 * @property {{status:'running'|'ended',startedAt:number,endsAt:number|null,report:ShiftReport|null}} shift
 * @property {Customer[]} line in queue order
 * @property {(Customer|null)[]} tables length 2
 * @property {Chef[]} chefs length 2
 * @property {string[]} readyQueue item ids, FIFO
 * @property {string[]} pass meal ids on the Pass (ready, sampled or approved; the Item's status says which)
 * @property {Record<string,Item>} items @property {Record<string,Meal>} meals
 * @property {number} score @property {ShiftStats} stats @property {number} watchers
 * @property {{seat:boolean,split:boolean,review:boolean,serve:boolean,ship:boolean}} guide
 * @property {{shots:string[],version:number}} tv shipped order ids in order; version for the showcase preview
 * @property {{redo:string[],serve:string[]}} chips
 * @property {{id:number,text:string,points:number,at:number,anchor:string}[]} pops last 8 score events
 */

/**
 * @typedef {object} Customer
 * @property {string} id @property {string} name @property {string} persona @property {1|2|3} strictness @property {number} look
 * @property {Order} order @property {number|null} table
 * @property {'in_line'|'seated'|'waiting_food'|'eating'|'awaiting_player'|'paying'|'left'} status
 * @property {Feedback} [feedback] @property {boolean} feedbackRead @property {number} feedbackRound
 * @property {Patience} [patience] @property {number} [seatedAt]
 * @property {{items:number,redos:number,tookMs:number,score:number,points:number}} [receipt]
 */

/**
 * @typedef {object} Order
 * @property {string} id @property {number} number @property {string} source @property {string} title @property {string} description
 * @property {string[]} acceptanceCriteria @property {1|2|3} difficulty @property {'S'|'M'|'L'} size
 * @property {QuickPick[]} quickPicks @property {string[]} itemIds
 */

/** @typedef {{id:string,label:string,prompt:string,station:Station,estCookMs:number}} QuickPick */

/**
 * @typedef {object} Item
 * @property {string} id @property {string} orderId @property {string} customerId @property {string} prompt
 * @property {Station} station @property {number} estCookMs
 * @property {'draft'|'queued'|'waiting_stove'|'cooking'|'ready'|'sampled'|'approved'|'served'|'burnt'} status
 * @property {boolean} typed @property {string} [quickPickId] @property {string} [redoReason] @property {number} redoCount
 * @property {string} [chefId] @property {string} [mealId]
 * @property {number} [cookStartedAt] @property {number} [cookEndsAt] earliest release; both unset while the Chef walks or waits for a stove
 */

/**
 * @typedef {object} Meal
 * @property {string} id @property {string} itemId @property {string} orderId @property {string} summary
 * @property {string[]} changedFiles @property {string} diff @property {Hunk[]} hunks @property {number} hunksSeen
 * @property {number} readyAt @property {boolean} setMenu @property {boolean} ranOut
 * @property {boolean} real a git diff from the showcase floor
 * @property {Patience} [patience]
 */

/** @typedef {{file:string,header:string,lines:{t:'+'|'-'|' ',text:string}[]}} Hunk */
/** @typedef {{satisfied:boolean,score:1|2|3|4|5,comments:string,suggestedFollowUps:{prompt:string,station:Station}[]}} Feedback */

/**
 * @typedef {object} Chef
 * @property {string} id @property {string} name @property {string} modelLabel
 * @property {'idle'|'walking'|'waiting_stove'|'cooking'|'plating'} status
 * @property {string} [itemId] @property {Station} [station] @property {number} [idleSince] @property {string} [thought]
 */

/** @typedef {{startedAt:number,durationMs:number,lost:number,angry:boolean}} Patience lost = points drained so far (0-20) */
/** @typedef {{shipped:number,meals:number,redos:number,firstTime:number,callBacks:number,callBackMsTotal:number,breakMs:number,longestWorkMs:number,patienceLost:number,idlePenalty:number}} ShiftStats */
/** @typedef {{shipped:number,points:number,reworkRate:number,avgCallBackMs:number,breakMs:number,longestWorkMs:number,verdict:string}} ShiftReport */

/** @typedef {{type:'floor',floor:FloorSnapshot,you:{isOwner:boolean,canAct:boolean},now:number}} FloorMessage */
/** @typedef {{type:'building',now:number,floors:FloorLine[],slots:{liveUsed:number,liveMax:number,judgeUsed:number,judgeMax:number,queued:number},liveOpen:boolean,park:{w:number,h:number}}} BuildingMessage */

export {};
