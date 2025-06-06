"use strict";

const skills = {};
const skill_categories = {};

import {character} from "./character.js";
import {stat_names} from "./misc.js";
import {paired_skill_sets, getGroupLeaderName} from "./main.js";

		

/*    
TODO:
    - elemental resistances for:
        - lessening environmental penalties of other types (mostly affecting stamina maybe?)
        - lessening elemental dmg (first need to implement damage types)
    - locked -> skill needs another action to unlock (doesnt gain xp)
*/

const weapon_type_to_skill = {
    "axe": "Axes",
    "dagger": "Daggers",
    "hammer": "Hammers",
    "sword": "Swords",
    "spear": "Spears",
    "staff": "Staffs",
    "wand": "Wands"
};

const which_skills_affect_skill = {};

class Skill {
    constructor({ skill_id, 
                  names, 
                  description, 
                  max_level = 60, 
                  max_level_coefficient = 1, 
                  max_level_bonus = 0, 
                  base_xp_cost = 40, 
                  visibility_treshold = 50,
                  get_effect_description = () => { return ''; }, 
                  parent_skill = null, 
                  rewards, 
                  xp_scaling = 1.8,
                  is_unlocked = true,
				  is_hidden = false,
                  category,
                }) 
    {
        if(skill_id === "all" || skill_id === "hero" || skill_id === "all_skill") {
            //would cause problem with how xp_bonuses are implemented
            throw new Error(`Id "${skill_id}" is not allowed for skills`);
        }

        this.skill_id = skill_id;
        this.names = names; // put only {0: name} to have skill always named the same, no matter the level
        this.description = description;
        this.current_level = 0; //initial lvl
        this.max_level = max_level; //max possible lvl, dont make it too high
        this.max_level_coefficient = max_level_coefficient; //multiplicative bonus for levels
        this.max_level_bonus = max_level_bonus; //other type bonus for levels
        this.current_xp = 0; // how much of xp_to_next_lvl there is currently
        this.total_xp = 0; // total collected xp, on loading calculate lvl based on this (so to not break skills if scaling ever changes)
        this.base_xp_cost = base_xp_cost; //xp to go from lvl 1 to lvl 2
        this.visibility_treshold = visibility_treshold < base_xp_cost ? visibility_treshold : base_xp_cost;  //xp needed for skill to become visible and to get "unlock" message; try to keep it less than xp needed for lvl
        this.is_unlocked = is_unlocked;
		this.is_hidden = is_hidden; // hides the skill if true. Skill still has effects but isn't displayed.
        this.xp_to_next_lvl = base_xp_cost; //for display only
        this.total_xp_to_next_lvl = base_xp_cost; //total xp needed to lvl up
        this.get_effect_description = get_effect_description;
        this.is_parent = false;
        if(!category) {
            console.warn(`Skill "${this.skill_id}" has no category defined and was defaulted to miscellaneous`);
            this.category = "Miscellaneous";
        } else {
            this.category = category;
            skill_categories[this.category] = this;
        }
        
        if(parent_skill) {
            if(skills[parent_skill]) {
                this.parent_skill = parent_skill;
                skills[parent_skill].is_parent = true;
            } else {
                throw new Error(`Skill "${parent_skill}" doesn't exist, so it can't be set as a parent skill`)
            }
        }

        this.rewards = rewards; //leveling rewards (and levels on which they are given)

        this.xp_scaling = xp_scaling > 1 ? xp_scaling : 1.6;
        //how many times more xp needed for next level
    }

    name() {
        if(this.visibility_treshold > this.total_xp) {
            return "?????";
        }
        
        const keys = Object.keys(this.names);
        if (keys.length == 1) {
            return (this.names[keys[0]]);
        }
        else {
            let rank_name;
            for (var i = 0; i <= keys.length; i++) {
                if (this.current_level >= parseInt(keys[i])) {
                    rank_name = this.names[keys[i]];
                }
                else {
                    break;
                }
            }
            return rank_name;
        }
    }

    add_xp({xp_to_add = 0}) {
        if(xp_to_add == 0 || !this.is_unlocked) {
            return;
        }
        xp_to_add = Math.round(xp_to_add*100)/100;

        this.total_xp = Math.round(100*(this.total_xp + xp_to_add))/100;
        if (this.current_level < this.max_level) { //not max lvl

            if (Math.round(100*(xp_to_add + this.current_xp))/100 < this.xp_to_next_lvl) { // no levelup
                this.current_xp = Math.round(100*(this.current_xp + xp_to_add))/100;
            }
            else { //levelup
                
                let level_after_xp = 0;
                let unlocks = {skills: []};

                //its alright if this goes over max level, it will be overwritten in a if-else below that
                while (this.total_xp >= this.total_xp_to_next_lvl) {

                    level_after_xp += 1;
                    this.total_xp_to_next_lvl = Math.round(100*this.base_xp_cost * (1 - this.xp_scaling ** (level_after_xp + 1)) / (1 - this.xp_scaling))/100;

                    if(this.rewards?.milestones[level_after_xp]?.unlocks?.skills) {
                        unlocks.skills.push(...this.rewards.milestones[level_after_xp].unlocks.skills);
                    }
                } //calculates lvl reached after adding xp
                //probably could be done much more efficiently, but it shouldn't be a problem anyway

                
                let total_xp_to_previous_lvl = Math.round(100*this.base_xp_cost * (1 - this.xp_scaling ** level_after_xp) / (1 - this.xp_scaling))/100;
                //xp needed for current lvl, same formula but for n-1

                if(level_after_xp == 0) { 
                    console.warn(`Something went wrong, calculated level of skill "${this.skill_id}" after a levelup was 0.`
                    +`\nxp_added: ${xp_to_add};\nprevious level: ${this.current_level};\ntotal xp: ${this.total_xp};`
                    +`\ntotal xp for that level: ${total_xp_to_previous_lvl};\ntotal xp for next level: ${this.total_xp_to_next_lvl}`);
                }

                let gains;
                if (level_after_xp < this.max_level) { //wont reach max lvl
                    gains = this.get_bonus_stats(level_after_xp);
                    this.xp_to_next_lvl = Math.round(100*(this.total_xp_to_next_lvl - total_xp_to_previous_lvl))/100;
                    this.current_level = level_after_xp;
                    this.current_xp = Math.round(100*(this.total_xp - total_xp_to_previous_lvl))/100;
                }
                else { //will reach max lvl
                    gains = this.get_bonus_stats(this.max_level);
                    this.current_level = this.max_level;
                    this.total_xp_to_next_lvl = "Already reached max lvl";
                    this.current_xp = "Max";
                    this.xp_to_next_lvl = "Max";
                }

                let skillName = getGroupLeaderName(this.skill_id);
				let message = `${skillName} has reached level ${this.current_level}`;

                if (Object.keys(gains.stats).length > 0 || Object.keys(gains.xp_multipliers).length > 0) { 
                    message += `<br><br> Thanks to ${this.name()} reaching new milestone, ${character.name} gained: `;

                    if (gains.stats) {
                        Object.keys(gains.stats).forEach(stat => {
                            if(gains.stats[stat].flat) {
                                message += `<br> +${gains.stats[stat].flat} ${stat_names[stat].replace("_"," ")}`;
                            }
                            if(gains.stats[stat].multiplier) {
                                message += `<br> x${Math.round(100*gains.stats[stat].multiplier)/100} ${stat_names[stat].replace("_"," ")}`;
                            }   
                        });
                    }

                    if (gains.xp_multipliers) {
                        Object.keys(gains.xp_multipliers).forEach(xp_multiplier => {
                            let name;
                            if(xp_multiplier !== "all" && xp_multiplier !== "hero" && xp_multiplier !== "all_skill") {
                                name = skills[xp_multiplier].name();
                                if(!skills[xp_multiplier]) {
                                    console.warn(`Skill ${this.skill_id} tried to reward an xp multiplier for something that doesn't exist: ${xp_multiplier}. I could be a misspelled skill name`);
                                }
                            } else {
                                name = xp_multiplier.replace("_"," ");
                            }
                            message += `<br> x${Math.round(100*gains.xp_multipliers[xp_multiplier])/100} ${name} xp gain`;
                        });
                    }
                }

                return {message, gains, unlocks};
            }
        }
        return {};
    }

    /**
     * @description only called on leveling; calculates all the bonuses gained, so they can be added to hero and logged in message log
     * @param {*} level 
     * @returns bonuses from milestones
     */
    get_bonus_stats(level) {
        //probably should rename, since it's not just stats anymore
        const gains = {stats: {}, xp_multipliers: {}};

        let stats;
        let xp_multipliers;

        for (let i = this.current_level + 1; i <= level; i++) {
            if (this.rewards?.milestones[i]) {
                stats = this.rewards.milestones[i].stats;
                xp_multipliers = this.rewards.milestones[i].xp_multipliers;
                
                if(stats) {
                    Object.keys(stats).forEach(stat => {
                        if(!gains.stats[stat]) {
                            gains.stats[stat] = {};
                        }
                        if(stats[stat].flat) {
                            gains.stats[stat].flat = (gains.stats[stat].flat || 0) + stats[stat].flat;
                        }
                        if(stats[stat].multiplier) {
                            gains.stats[stat].multiplier =  (gains.stats[stat].multiplier || 1) * stats[stat].multiplier;
                        }
                        
                    });
                }

                if(xp_multipliers) {
                    Object.keys(xp_multipliers).forEach(multiplier => {
                        gains.xp_multipliers[multiplier] = (gains.xp_multipliers[multiplier] || 1) * xp_multipliers[multiplier];
                        if(which_skills_affect_skill[multiplier]) {
                            if(!which_skills_affect_skill[multiplier].includes(this.skill_id)) {
                                which_skills_affect_skill[multiplier].push(this.skill_id);
                            }
                        } else {
                            which_skills_affect_skill[multiplier] = [this.skill_id];
                        }
                       
                    });
                }
            }
        }
        
        Object.keys(gains.stats).forEach((stat) => {
            if(gains.stats[stat].multiplier) {
                gains.stats[stat].multiplier = Math.round(100 * gains.stats[stat].multiplier) / 100;
            }
        });
        
        return gains;
    }
		get_coefficient(scaling_type) { //starts from 1
			switch (scaling_type) {
				case "flat":
					return 1 + Math.round((this.max_level_coefficient - 1) * this.current_level / this.max_level * 1000) / 1000;
				case "multiplicative":
					return Math.round(Math.pow(this.max_level_coefficient, this.current_level / this.max_level) * 1000) / 1000;
				case "reverse_multiplicative": // New scaling type (1.0 → 0.25)
					return Math.round((1.0 - (0.75 * (this.current_level / this.max_level))) * 1000) / 1000;
				default: //same as multiplicative
					return Math.round(Math.pow(this.max_level_coefficient, this.current_level / this.max_level) * 1000) / 1000;
			}
		}
    get_level_bonus() { //starts from 0
        return this.max_level_bonus * this.current_level / this.max_level;
    }
    get_parent_xp_multiplier() {
        if(this.parent_skill) {
            return (1.1**Math.max(0,skills[this.parent_skill].current_level-this.current_level));
        } else {
            return 1;
        }
    }
}

/**
 * @param {String} skill_id key from skills object
 * @returns all unlocked leveling rewards, formatted to string
 */
function get_unlocked_skill_rewards(skill_id) {
    let unlocked_rewards = '';
    
    if(skills[skill_id].rewards){ //rewards
        const milestones = Object.keys(skills[skill_id].rewards.milestones).filter(level => level <= skills[skill_id].current_level);
        if(milestones.length > 0) {
            unlocked_rewards = `lvl ${milestones[0]}: ${format_skill_rewards(skills[skill_id].rewards.milestones[milestones[0]])}`;
            for(let i = 1; i < milestones.length; i++) {
                unlocked_rewards += `<br>\n\nlvl ${milestones[i]}: ${format_skill_rewards(skills[skill_id].rewards.milestones[milestones[i]])}`;
            }
        }
    } else { //no rewards
        return '';
    }

    return unlocked_rewards;
}

/**
 * gets rewards for next lvl
 * @param {String} skill_id key used in skills object
 * @returns rewards for next level, formatted to a string
 */
/*
function get_next_skill_reward(skill_id) {
    if(skills[skill_id].current_level !== "Max!") {
        let rewards = skills[skill_id].rewards.milestones[get_next_skill_milestone(skill_id)];
        
        if(rewards) {
            return format_skill_rewards(rewards);
        } else {
            return '';
        }
    } else {
        return '';
    }
}
*/

/**
 * 
 * @param {*} skill_id key used in skills object
 * @returns next lvl at which skill has any rewards
 */
function get_next_skill_milestone(skill_id){
    let milestone;
    if(skills[skill_id].rewards){
        milestone = Object.keys(skills[skill_id].rewards.milestones).find(
            level => level > skills[skill_id].current_level);
    }
    return milestone;
}

/**
 * @param milestone milestone from object rewards - {stats: {stat1, stat2... }} 
 * @returns rewards formatted to a nice string
 */
function format_skill_rewards(milestone){
    let formatted = '';
    if(milestone.stats) {
        let temp = '';
        Object.keys(milestone.stats).forEach(stat => {
            if(milestone.stats[stat].flat) {
                if(formatted) {
                    formatted += `, +${milestone.stats[stat].flat} ${stat_names[stat]}`;
                } else {
                    formatted = `+${milestone.stats[stat].flat} ${stat_names[stat]}`;
                }
            }
            if(milestone.stats[stat].multiplier) {
                if(temp) {
                    temp += `, x${milestone.stats[stat].multiplier} ${stat_names[stat]}`;
                } else {
                    temp = `x${milestone.stats[stat].multiplier} ${stat_names[stat]}`;
                }
            }
        });
        if(formatted) {
            formatted += ", " + temp;
        } else {
            formatted = temp;
        }
    }

    if(milestone.xp_multipliers) {
        const xp_multipliers = Object.keys(milestone.xp_multipliers);
        let name;
        if(xp_multipliers[0] !== "all" && xp_multipliers[0] !== "hero" && xp_multipliers[0] !== "all_skill") {
            name = skills[xp_multipliers[0]].name();
        } else {
            name = xp_multipliers[0].replace("_"," ");
        }
        if(formatted) {
            formatted += `, x${milestone.xp_multipliers[xp_multipliers[0]]} ${name} xp gain`;
        } else {
            formatted = `x${milestone.xp_multipliers[xp_multipliers[0]]} ${name} xp gain`;
        }
        for(let i = 1; i < xp_multipliers.length; i++) {
            let name;
            if(xp_multipliers[i] !== "all" && xp_multipliers[i] !== "hero" && xp_multipliers[i] !== "all_skill") {
                name = skills[xp_multipliers[i]].name();
            } else {
                name = xp_multipliers[i].replace("_"," ");
            }
            formatted += `, x${milestone.xp_multipliers[xp_multipliers[i]]} ${name} xp gain`;
        }
    }
    if(milestone.unlocks) {
        const unlocked_skills = milestone.unlocks.skills;
        if(formatted) {
            formatted += `, <br> Unlocked skill "${milestone.unlocks.skills[0]}"`;
        } else {
            formatted = `Unlocked skill "${milestone.unlocks.skills[0]}"`;
        }
        for(let i = 1; i < unlocked_skills.length; i++) {
            formatted += `, "${milestone.unlocks.skills[i]}"`;
        }
    }
    return formatted;
}

//basic combat skills

(function(){
    skills["Combat"] = new Skill({skill_id: "Combat", 
                                names: {0: "Combat"}, 
                                category: "Combat",
                                description: "Overall combat ability", 
                                max_level_coefficient: 2,
                                base_xp_cost: 60,
                                get_effect_description: ()=> {
                                    return `Multiplies hit chance by ${Math.round(skills["Combat"].get_coefficient("multiplicative")*1000)/1000}`;
                                }});
	   skills["Battling"] = new Skill({skill_id: "Battling", 
                                names: {0: "Battling", 15: "Battle Master"}, 
                                description: "Your proficiency for fighting even opponents.", 
                                category: "Combat",
								base_xp_cost: 100,
								max_level_coefficient: 1.4,
								get_effect_description: ()=> {
										return `Multiplies damage against medium sized enemies by ${Math.round(skills["Battling"].get_coefficient("multiplicative")*1000)/1000}`;
								},
								
	});	

    
    skills["Pest killer"] = new Skill({skill_id: "Pest killer", 
                                names: {0: "Pest killer", 15: "Pest slayer"}, 
                                description: "Small enemies might not seem very dangerous, but it's not that easy to hit them!", 
                                max_level_coefficient: 2,
                                category: "Combat",
                                base_xp_cost: 100,
                                get_effect_description: ()=> {
                                    return `Multiplies hit chance against small-type enemies by ${Math.round(skills["Pest killer"].get_coefficient("multiplicative")*1000)/1000}`;
                                },
                                rewards:
                                {
                                    milestones: {
                                        1: {
                                            xp_multipliers: {
                                                Combat: 1.05,
                                            }
                                        },
                                        3: {
                                            stats: {
                                                "dexterity": {flat: 1},
                                            },
                                            xp_multipliers: {
                                                Combat: 1.1,
                                            }
                                        },
                                        5: {
                                            stats: {
                                                "dexterity": {multiplier: 1.05},
                                            },
                                            xp_multipliers: {
                                                "Evasion": 1.1,
                                                "Shield blocking": 1.1,
                                            }
                                        }
                                    }
                                }
                            });    
                                
    skills["Giant slayer"] = new Skill({skill_id: "Giant slayer", 
                                names: {0: "Giant killer", 15: "Giant slayer"}, 
                                description: "Large opponents might seem scary, but just don't get hit and you should be fine!", 
                                max_level_coefficient: 2,
                                category: "Combat",
								base_xp_cost: 100,
                                get_effect_description: ()=> {
                                    return `Multiplies evasion against large-type enemies by ${Math.round(skills["Giant slayer"].get_coefficient("multiplicative")*1000)/1000}`;
                                }});
		    skills["Adaptive combat"] = new Skill({skill_id: "Adaptive combat", 
                                names: {0: "Adaptive combat"}, 
                                category: "Combat",
                                description: "Perfectly adapt your strategies to handle foes of any size or stature.", 
                                category: "Combat",
                                base_xp_cost: 100,
                                get_effect_description: ()=> {
                                    return `Multiplies hit chance against small-type enemies by ${Math.round(skills["Pest killer"].get_coefficient("multiplicative")*1000)/1000} 
									<br>Multiplies damage against medium sized enemies by ${Math.round(skills["Battling"].get_coefficient("multiplicative")*1000)/1000}
									<br>Multiplies evasion against large-type enemies by ${Math.round(skills["Giant slayer"].get_coefficient("multiplicative")*1000)/1000}`;
									
                                },
									        rewards: {
            milestones: {
                15: {
                    stats: {
                        agility: {flat: 2},
                    }
                },
                20: {
                    stats: {
                        agility: {flat: 3},
                    }
                },
                25: {
                    stats: {
                        agility: {flat: 5},
                    }
                },
                30: {
                    stats: {
                        agility: {multiplier: 1.02},
                    }
                },
            }
        }
								});

    skills["Evasion"] = new Skill({skill_id: "Evasion", 
                                names: {0: "Evasion"},                                
                                description:"Ability to evade attacks", 
                                max_level_coefficient: 2,
                                base_xp_cost: 30,
                                category: "Combat",
                                get_effect_description: ()=> {
                                    return `Multiplies your evasion chance by ${Math.round(skills["Evasion"].get_coefficient("multiplicative")*1000)/1000}`;
                                },
                                rewards: {
                                    milestones: {
                                        1: {
                                            stats: {
                                                "agility": {flat: 1},
                                            }
                                        },
                                        3: {
                                            stats: {
                                                "agility": {flat: 1},
                                            },
                                            xp_multipliers: {
                                                Equilibrium: 1.05,
                                            }
                                        },
                                        5: {
                                            stats: {
                                                "agility": {
                                                    flat: 1,
                                                    multiplier: 1.05,
                                                }
                                            },
                                        },
                                        7: {
                                            stats: {
                                                "agility": {flat: 2},
                                            },
                                            xp_multipliers: {
                                                Equilibrium: 1.05,
                                            }
                                        },
                                        10: {
                                            stats: {
                                                "agility": {
                                                    flat: 1,
                                                    multiplier: 1.05,
                                                }
                                            },
                                        }
                                    }
                                }
                            });
    skills["Shield blocking"] = new Skill({skill_id: "Shield blocking", 
                                    names: {0: "Shield blocking"}, 
                                    description: "Ability to block attacks with shield", 
                                    max_level: 30, 
                                    max_level_bonus: 0.2,
									base_xp_cost: 30,
                                    category: "Combat",
                                    get_effect_description: ()=> {
                                        return `Increases block chance by flat ${Math.round(skills["Shield blocking"].get_level_bonus()*1000)/10}%. Increases blocked damage by ${Math.round(skills["Shield blocking"].get_level_bonus()*5000)/10}%`;
                                    }});
									
	   skills["Counterattack"] = new Skill({skill_id: "Counterattack", 
                                    names: {0: "Counterattack"}, 
                                    description: "Counterattack proficiency", 
                                    max_level: 30, 
                                    base_xp_cost: 30,
									max_level_coefficient: 3,
                                    category: "Combat",
                                    get_effect_description: ()=> {
                                        return `Multiplies counterattack chance and damage by ${Math.round(skills["Counterattack"].get_coefficient("multiplicative")*1000)/1000} `;
                                    }});								
	skills["Parrying"] = new Skill({
        skill_id: "Parrying",
        names: {0: "Parrying"},
        description: "Parrying",
        category: "Combat",
        base_xp_cost: 30,
        max_level: 30,
		max_level_bonus: 0.8,
		get_effect_description: ()=> {
            return `Increases Parrying chance by ${(skills["Parrying"].get_level_bonus().toPrecision(3))}`;
        },
    });
    	skills["Reactive combat"] = new Skill({
        skill_id: "Reactive combat",
        names: {0: "Reactive combat"},
        description: "Mastery of blocking, parrying and counterattacks",
        category: "Combat",
        base_xp_cost: 30,
        max_level: 30,
		get_effect_description: ()=> {
            return `Increases Parrying chance by ${(skills["Parrying"].get_level_bonus().toPrecision(3))}
			<br>Multiplies counterattack chance and damage by ${Math.round(skills["Counterattack"].get_coefficient("multiplicative")*1000)/1000}
			<br>Increases block chance by flat ${Math.round(skills["Shield blocking"].get_level_bonus()*1000)/10}%. Increases blocked damage by ${Math.round(skills["Shield blocking"].get_level_bonus()*5000)/10}%`;
        },
		        rewards: {
            milestones: {
                15: {
                    stats: {
                        dexterity: {flat: 2},
                    }
                },
                20: {
                    stats: {
                        dexterity: {flat: 3},
                    }
                },
                25: {
                    stats: {
                        dexterity: {flat: 5},
                    }
                },
                30: {
                    stats: {
                        dexterity: {multiplier: 1.02},
                    }
                },
            }
        }
    });
	
     

							
})();


//combat stances
(function(){
    skills["Stance mastery"] = new Skill({skill_id: "Stance mastery", 
                                    names: {0: "Stance proficiency", 10: "Stance mastery"}, 
                                    description: "Knowledge on how to apply different stances in combat",
                                    base_xp_cost: 60,
                                    category: "Stance",
                                    max_level: 30,
                                    get_effect_description: ()=> {
                                        return `Increases xp gains of all combat stance skills of level lower than this, x1.1 per level of difference`;
                                    },
                                });
    skills["Quick steps"] = new Skill({skill_id: "Quick steps", 
                                names: {0: "Quick steps"}, 
                                parent_skill: "Stance mastery",
                                description: "A swift and precise technique that abandons strength in favor of greater speed", 
                                max_level_coefficient: 2,
                                base_xp_cost: 60,
                                category: "Stance",
                                max_level: 30,
                                get_effect_description: ()=> {
                                    return `Improves efficiency of the 'Quick Steps' stance`;
                                }});
    skills["Heavy strike"] = new Skill({skill_id: "Heavy strike", 
                                names: {0: "Crushing force"}, 
                                parent_skill: "Stance mastery",
                                description: "A powerful and dangerous technique that abandons speed in favor of overwhelmingly strong attacks", 
                                max_level_coefficient: 2,
                                base_xp_cost: 60,
                                category: "Stance",
                                max_level: 30,
                                get_effect_description: ()=> {
                                    return `Improves efficiency of the "Crushing force" stance`;
                                }});
    skills["Wide swing"] = new Skill({skill_id: "Wide swing", 
                                names: {0: "Broad arc"}, 
                                parent_skill: "Stance mastery",
                                description: "A special technique that allows striking multiple enemies at once, although at a cost of lower damage", 
                                max_level_coefficient: 2,
                                base_xp_cost: 60,
                                category: "Stance",
                                max_level: 30,
                                get_effect_description: ()=> {
                                    return `Improves efficiency of the "Broad arc" stance`;
                                }});
    skills["Defensive measures"] = new Skill({skill_id: "Defensive measures", 
                                names: {0: "Defensive measures"}, 
                                parent_skill: "Stance mastery",
                                description: "A careful technique focused much more on defense and counterattacking, instead of direct attacking", 
                                max_level_coefficient: 2,
                                base_xp_cost: 60,
                                category: "Stance",
                                max_level: 30,
                                get_effect_description: ()=> {
                                    return `Improves efficiency of the 'Defensive Measures' stance`;
                                }});
    skills["Protect"] = new Skill({skill_id: "Protect", 
                                names: {0: "Protect"}, 
                                parent_skill: "Stance mastery",
                                description: "A technique to protect allies at the expense of damage output.", 
                                max_level_coefficient: 2,
                                base_xp_cost: 60,
                                category: "Stance",
                                max_level: 30,
                                get_effect_description: ()=> {
                                    return `Improves efficiency of the 'Protect' stance`;
                                }});
    skills["Berserker's stride"] = new Skill({skill_id: "Berserker's stride", 
                                names: {0: "Berserker's stride"}, 
                                parent_skill: "Stance mastery",
                                description: "A wild and dangerous technique that focuses on dealing as much damage as possible, while completely ignoring own defense", 
                                max_level_coefficient: 2,
                                base_xp_cost: 60,
                                category: "Stance",
                                max_level: 30,
                                get_effect_description: ()=> {
                                    return `Improves efficiency of the 'Berserker's Stride' stance`;
                                }});                  
    skills["Flowing water"] = new Skill({skill_id: "Flowing water", 
                                names: {0: "Flowing water"}, 
                                parent_skill: "Stance mastery",
                                description: "A wild and dangerous technique that focuses on dealing as much damage as possible, while completely ignoring own defense", 
                                max_level_coefficient: 2,
                                base_xp_cost: 60,
                                category: "Stance",
                                max_level: 30,
                                get_effect_description: ()=> {
                                    return `Improves efficiency of the 'Flowing Water' stance`;
                                }}); 
	    skills["Heaven's Sword Technique"] = new Skill({skill_id: "Heaven's Sword Technique", 
                                names: {0: "Heaven's Sword Technique"}, 
                                parent_skill: "Stance mastery",
                                description: "A highly draining martial technique, designed for fighting a single opponent.", 
                                max_level_coefficient: 2,
                                base_xp_cost: 60,
                                category: "Stance",
                                max_level: 30,
                                get_effect_description: ()=> {
                                    return `Improves efficiency of 'Heaven's Sword Technique' stance`;
                                }}); 
		skills["Serpent Strikes"] = new Skill({skill_id: "Serpent Strikes", 
                                names: {0: "Serpent Strikes"}, 
                                parent_skill: "Stance mastery",
                                description: "A technique based around precise lethal strikes.", 
                                max_level_coefficient: 2,
                                base_xp_cost: 60,
                                category: "Stance",
                                max_level: 30,
                                get_effect_description: ()=> {
                                    return `Improves efficiency of 'Serpent Strikes' stance`;
                                }}); 
        
        
                               
})();

//environment related skills
(function(){
    skills["Spatial awareness"] = new Skill({
                                            skill_id: "Spatial awareness", 
                                            names: {0: "Spatial awareness"}, 
                                            description: "Understanding where you are in relation to other creatures and objects", 
                                            get_effect_description: ()=> {
                                                return `Reduces environmental penalty in open areas by ${Math.round((1-((1-(skills["Spatial awareness"].current_level/skills["Spatial awareness"].max_level))))*1000)/10}%`;
                                            },
                                            category: "Resistance",
                                            rewards: {
                                                milestones: {
                                                    3: {
                                                        xp_multipliers:{ 
                                                            Evasion: 1.1,
                                                            "Shield blocking": 1.1,
                                                        },
                                                    },
                                                    5: {
                                                        xp_multipliers: {
                                                            Combat: 1.1,
                                                        }
                                                    },
                                                    8: {
                                                        xp_multipliers: {
                                                            all_skill: 1.1,
                                                        }
                                                    }
                                                }
                                            }
                                        });
    skills["Tight maneuvers"] = new Skill({
                                        skill_id: "Tight maneuvers", 
                                        names: {0: "Tight maneuvers"}, 
                                        description: "Learn how to fight in narrow environment, where there's not much space for dodging attacks", 
                                        category: "Resistance",
                                        get_effect_description: ()=> {
                                            return `Reduces environmental penalty in narrow areas by ${Math.round((1-((1-(skills["Tight maneuvers"].current_level/skills["Tight maneuvers"].max_level))))*1000)/10}%`;
                                        },
                                        rewards: {
                                            milestones: {
                                                3: {
                                                    xp_multipliers: {
                                                        Evasion: 1.1,
                                                        "Shield blocking": 1.1,
                                                    }
                                                },
                                                5: {
                                                    xp_multipliers: {
                                                        Combat: 1.1,
                                                    }
                                                },
                                            }
                                        }
                                    });
    skills["Night vision"] = new Skill({
                                    skill_id: "Night vision",
                                    names: {0: "Night vision"},
                                    description: "Ability to see in darkness",
                                    base_xp_cost: 600,
                                    xp_scaling: 1.9,
                                    max_level: 10,
                                    category: "Resistance",
                                    get_effect_description: () => {
                                        return `Reduces darkness penalty (except for 'pure darkness') by ${Math.round((1-((1-(skills["Night vision"].current_level/skills["Night vision"].max_level))))*1000)/10}%`;
                                    },
                                    rewards: {
                                        milestones: {
                                            2: {
                                                stats: {
                                                    intuition: {flat: 1},
                                                }
                                            },
                                            3: {
                                                xp_multipliers: {
                                                    Evasion: 1.05,
                                                    "Shield blocking": 1.05,
                                                }
                                            },
                                            4: {
                                                stats: {
                                                    intuition: {flat: 1},
                                                },
                                                xp_multipliers: {
                                                   "Presence sensing": 1.05
                                                }

                                             },
                                            5: {    
                                                xp_multipliers: 
                                                {
                                                    Combat: 1.1,
                                                },
                                                stats: {
                                                    intuition: {multiplier: 1.05},
                                                }
                                            },
                                            6: {
                                                xp_multipliers: {
                                                    "Presence sensing": 1.1,
                                                }
                                            }
                                        }
                                    }
                            });
    skills["Presence sensing"] = new Skill({
                skill_id: "Presence sensing",
                names: {0: "Presence sensing"},
                description: "Ability to sense a presence without using your eyes",
                base_xp_cost: 60,
                xp_scaling: 2,
                max_level: 20,
                category: "Resistance",
                get_effect_description: () => {
                    return `Reduces extreme darkness penalty by ${Math.round((1-((1-(skills["Presence sensing"].current_level/skills["Presence sensing"].max_level))))*1000)/10}%`;
                },
                rewards: {
                    milestones: {
                        1: {
                            stats: {
                                intuition: {flat: 1},
                            },
                            xp_multipliers: {
                                "Night vision": 1.1,
                            }
                        },
                        
                        2: {
                            xp_multipliers: {
                                Evasion: 1.1,
                                "Shield blocking": 1.1,
                            }
                        },
                        3: {
                            stats: {
                                intuition: {flat: 1},
                            },
                            xp_multipliers: {
                               "Combat": 1.1
                            }

                         },
                        4: {    
                            xp_multipliers: 
                            {
                                all_skill: 1.05,
                            },
                            stats: {
                                intuition: {multiplier: 1.1},
                            }
                        },
                        5: {
                            xp_multipliers: {
                                all: 1.05,
                            }
                        }
                    }
                }
            });
    skills["Heat resistance"] = new Skill({
        skill_id: "Heat resistance",
        names: {0: "Heat resistance"},
        description: "Ability to survive and function in high temperatures",
        base_xp_cost: 100,
        max_level: 40,
        category: "Resistance",
        get_effect_description: ()=> {
            return `Reduces damage taken and status debuffs from heat. <br> <br>Reduces:<br>
			Burn active effect damage by ${(Math.round((skills["Heat resistance"].current_level/skills["Heat resistance"].max_level)*100)*1000)/1000}%, <br> 
			Heat (non-combat) damage by ${(Math.round((skills["Heat resistance"].current_level/skills["Heat resistance"].max_level)*100)*1000)/1000}%,<br>
			Heat field (combat) damage by ${Math.round((1-((1-(skills["Heat resistance"].current_level/skills["Heat resistance"].max_level))**0.66667))*1000)/10}%,<br>
			Heat (combat) penalties by ${Math.round((1-((1-(skills["Heat resistance"].current_level/skills["Heat resistance"].max_level))))*1000)/10}%`;
        },
	        rewards: {
            milestones: {
                3: {
                    stats: {
                        max_health: {multiplier: 1.01},
                    }
                },
                5: {
                    stats: {
                        max_health: {multiplier: 1.01},
                    }
                },
                7: {
                    stats: {
                       "strength": {flat: 1},
                    }
                },
                10: {
                    stats: {
                        max_health: {multiplier: 1.01},
                    }
                },
                12: {
                    stats: {
                        max_health: {multiplier: 1.01},
                    }
                }
            }
        }
    });
	    skills["Thermal resistance"] = new Skill({
        skill_id: "Thermal resistance",
        names: {0: "Thermal resistance"},
        description: "Ability to survive and function in extreme temperatures",
        base_xp_cost: 100,
        max_level: 40,
        category: "Resistance",
           get_effect_description: ()=> {
            return `Reduces damage taken and status debuffs from cold and heat. <br> <br>Reduces:<br>
			Freeze active effect effects by ${(Math.round((skills["Cold resistance"].current_level/skills["Cold resistance"].max_level)*100)*1000)/1000}%, <br> 
			Burn active effect damage by ${(Math.round((skills["Heat resistance"].current_level/skills["Heat resistance"].max_level)*100)*1000)/1000}%, <br> 
			Cold  & Heat (non-combat) damage by ${(Math.round((skills["Cold resistance"].current_level/skills["Cold resistance"].max_level)*100)*1000)/1000}%,<br>
			Cold & Heat field (combat) damage by ${Math.round((1-((1-(skills["Cold resistance"].current_level/skills["Cold resistance"].max_level))**0.66667))*1000)/10}%,<br>
			Cold & Heat (combat) penalties by ${Math.round((1-((1-(skills["Cold resistance"].current_level/skills["Cold resistance"].max_level))))*1000)/10}%,<br>
			Retains milestone bonuses from constituent skills.`;
        },
	});
	
	
    skills["Cold resistance"] = new Skill({
        skill_id: "Cold resistance",
        names: {0: "Cold resistance"},
        description: "Ability to survive and function in low temperatures",
        base_xp_cost: 100,
        max_level: 40,
        category: "Resistance",
           get_effect_description: ()=> {
            return `Reduces damage taken and status debuffs from cold. <br> <br>Reduces:<br>
			Freeze active effect effects by ${(Math.round((skills["Cold resistance"].current_level/skills["Cold resistance"].max_level)*100)*1000)/1000}%, <br> 
			Cold (non-combat) damage by ${(Math.round((skills["Cold resistance"].current_level/skills["Cold resistance"].max_level)*100)*1000)/1000}%,<br>
			Cold field (combat) damage by ${Math.round((1-((1-(skills["Cold resistance"].current_level/skills["Cold resistance"].max_level))**0.66667))*1000)/10}%,<br>
			Cold (combat) penalties by ${Math.round((1-((1-(skills["Cold resistance"].current_level/skills["Cold resistance"].max_level))))*1000)/10}%`;
			
			
        },
        rewards: {
            milestones: {
                3: {
                    stats: {
                        max_health: {multiplier: 1.01},
                    }
                },
                5: {
                    stats: {
                        max_health: {multiplier: 1.01},
                    }
                },
                7: {
                    stats: {
                       "strength": {flat: 1},
                    }
                },
                10: {
                    stats: {
                        max_health: {multiplier: 1.01},
                    }
                },
                12: {
                    stats: {
                        max_health: {multiplier: 1.01},
                    }
                }
            }
        }
    });

    skills["Dazzle resistance"] = new Skill({
        skill_id: "Dazzle resistance",
        names: {0: "Dazzle resistance"},
        description: "Don't look at the sun, it's bad for your eyes",
        base_xp_cost: 60,
        max_level: 30,
        category: "Resistance",
        get_effect_description: ()=> {
            return `Reduces hit and evasion penalty in super bright areas`;
        },
        max_level_bonus: 0.5
    });
	
skills["Poison resistance"] = new Skill({
        skill_id: "Poison resistance",
        names: {0: "Poison resistance"},
        description: "Poison resistance",
        base_xp_cost: 60,
        max_level: 30,
        category: "Resistance",
        get_effect_description: ()=> {
            return `Reduces damage taken from poison:<br> <br>
			Poison active effect damage by ${(Math.round((skills["Poison resistance"].current_level/skills["Poison resistance"].max_level)*100)*1000)/1000}%, <br> 
			Poison ambient (non-combat) damage by ${(Math.round((skills["Poison resistance"].current_level/skills["Poison resistance"].max_level)*100)*1000)/1000}%,<br>
			Poison field (combat) damage by ${Math.round((1-((1-(skills["Poison resistance"].current_level/skills["Poison resistance"].max_level))**0.66667))*1000)/10}% `;
			
			
        },
        max_level_bonus: 0.5
    });
	
skills["Curse resistance"] = new Skill({
        skill_id: "Curse resistance",
        names: {0: "Curse resistance"},
        description: "Curse resistance",
        base_xp_cost: 60,
        max_level: 30,
        category: "Resistance",
        get_effect_description: ()=> {
            return `Reduces effect of curses`;
        },
        max_level_bonus: 0.5
    });
	
skills["Shock resistance"] = new Skill({
        skill_id: "Shock resistance",
        names: {0: "Shock resistance"},
        description: "Shock resistance",
        base_xp_cost: 60,
        max_level: 30,
        category: "Resistance",
        get_effect_description: ()=> {
            return `Reduces impact of storms`;
        },
        max_level_bonus: 0.5
    });
})();

//weapon skills
(function(){
    skills["Weapon mastery"] = new Skill({skill_id: "Weapon mastery", 
                                    names: {0: "Weapon proficiency", 15: "Weapon mastery"}, 
                                    description: "Knowledge of all weapons",
                                    category: "Weapon",
                                    get_effect_description: ()=> {
                                        return `Increases xp gains of all weapon skills of level lower than this, x1.1 per level of difference`;
                                    },
                                });
	 skills["Integrated Weapons Mastery"] = new Skill({skill_id: "Integrated Weapons Mastery", 
                                    names: {0: "Integrated Weapons Mastery"}, 
                                    description: "Mastery of all weapons.",
                                    category: "Weapon",
                                    get_effect_description: ()=> {
                                        return `Multiplies damage dealt with axes, hammers,swords, spears & daggers by ${Math.round(skills["Swords"].get_coefficient("multiplicative")*1000)/1000}.<br>
												Multiplies AP with axes, hammers,swords, spears & daggers by ${Math.round((skills["Swords"].get_coefficient("multiplicative")**0.3333)*1000)/1000}.<br>
												Multiplies damage dealt in unarmed combat by ${Math.round(skills["Unarmed"].get_coefficient("multiplicative")*1000)/1000}.<br>
												Multiplies attack speed and AP in unarmed combat by ${Math.round((skills["Unarmed"].get_coefficient("multiplicative")**0.3333)*1000)/1000}.<br>
												Retains milestone bonuses from constituent skills`;
                                    },
                                });
								
    skills["Swords"] = new Skill({skill_id: "Swords", 
                                  parent_skill: "Weapon mastery",
                                  names: {0: "Swordsmanship"}, 
                                  category: "Weapon",
                                  description: "The noble art of swordsmanship", 
                                  get_effect_description: ()=> {
                                      return `Multiplies damage dealt with swords by ${Math.round(skills["Swords"].get_coefficient("multiplicative")*1000)/1000}.
Multiplies AP with swords by ${Math.round((skills["Swords"].get_coefficient("multiplicative")**0.3333)*1000)/1000}`;
                                  },
                                  rewards: {
                                    milestones: {
                                        1: {
                                            stats: {
                                                "dexterity": {flat: 1},
                                            }
                                        },
                                        3: {
                                            stats: {
                                                "agility": {flat: 1},
                                            }
                                        },
                                        5: {
                                            stats: {
                                                "strength": {flat: 1},
                                                "crit_rate": {flat: 0.01},
                                            },
                                        },
                                        7: {
                                            stats: {
                                                "dexterity": {flat: 1},
                                            }
                                        },
                                        10: {
                                            stats: {
                                                "agility": {flat: 1},
                                                "crit_multiplier": {flat: 0.1}, 
                                            },
                                        },
                                        12: {
                                            stats: {
                                                "dexterity": {flat: 2},
                                            }
                                        },
                                    }
                                 },
                                 max_level_coefficient: 8
                            });

    skills["Axes"] = new Skill({skill_id: "Axes", 
                                parent_skill: "Weapon mastery",
                                names: {0: "Axe combat"}, 
                                category: "Weapon",
                                description: "Ability to fight with use of axes", 
                                get_effect_description: ()=> {
                                    return `Multiplies damage dealt with axes by ${Math.round(skills["Axes"].get_coefficient("multiplicative")*1000)/1000}.
Multiplies AP with axes by ${Math.round((skills["Axes"].get_coefficient("multiplicative")**0.3333)*1000)/1000}`;
                                },
                                rewards: {
                                    milestones: {
                                        1: {
                                            stats: {
                                                "dexterity": {flat: 1},
                                            }
                                        },
                                        3: {
                                            stats: {
                                                "strength": {flat: 1},
                                            }
                                        },
                                        5: {
                                            stats: {
                                                "dexterity": {flat: 1},
                                                "strength": {flat: 1},
                                            },
    
                                        },
                                        7: {
                                            stats: {
                                                "dexterity": {flat: 1},
                                            }
                                        },
                                        10: {
                                            stats: {
                                                    "strength": {flat: 1.05},
                                            },
                                        },
                                        12: {
                                            stats: {
                                                "dexterity": {flat: 2},
                                            }
                                        },
                                    }
                                 },
                                max_level_coefficient: 8});

    skills["Spears"] = new Skill({skill_id: "Spears", 
                                parent_skill: "Weapon mastery",
                                names: {0: "Spearmanship"}, 
                                category: "Weapon",
                                description: "The ability to fight with the most deadly weapon in the history", 
                                get_effect_description: ()=> {
                                    return `Multiplies damage dealt with spears by ${Math.round(skills["Spears"].get_coefficient("multiplicative")*1000)/1000}.
Multiplies AP with spears by ${Math.round((skills["Spears"].get_coefficient("multiplicative")**0.3333)*1000)/1000}`;
                                },
                                rewards: {
                                    milestones: {
                                        1: {
                                            stats: {
                                                "dexterity": {flat: 1},
                                            }
                                        },
                                        3: {
                                            stats: {
                                                "dexterity": {flat: 1},
                                            }
                                        },
                                        5: {
                                            stats: {
                                                "strength": {flat: 1},
                                                "crit_rate": {flat: 0.01},
                                            },
                                        },
                                        7: {
                                            stats: {
                                                "dexterity": {flat: 1},
                                            }
                                        },
                                        10: {
                                            stats: {
                                                "strength": {flat: 1},
                                                "crit_multiplier": {flat: 0.1}, 
                                            },
                                        },
                                        12: {
                                            stats: {
                                                "dexterity": {flat: 2},
                                            }
                                        },
                                    }
                                 },
                                max_level_coefficient: 8});

    skills["Hammers"] = new Skill({skill_id: "Hammers", 
                                        parent_skill: "Weapon mastery",
                                        names: {0: "Hammer combat"}, 
                                        category: "Weapon",
                                        description: "Ability to fight with use of battle hammers. Why bother trying to cut someone, when you can just crack all their bones?", 
                                        get_effect_description: ()=> {
                                            return `Multiplies damage dealt with battle hammers by ${Math.round(skills["Hammers"].get_coefficient("multiplicative")*1000)/1000}.
Multiplies AP with hammers by ${Math.round((skills["Hammers"].get_coefficient("multiplicative")**0.3333)*1000)/1000}`;
                                        },
                                        rewards: {
                                            milestones: {
                                                1: {
                                                    stats: {
                                                        "strength": {flat: 1},
                                                    }
                                                },
                                                3: {
                                                    stats: {
                                                        "strength": {flat: 1},
                                                    }
                                                },
                                                5: {
                                                    stats: {
                                                        "strength": {flat: 1},
                                                        "dexterity": {flat: 1},
                                                    },
                                                },
                                                7: {
                                                    stats: {
                                                        "strength": {flat: 1},
                                                    }
                                                },
                                                10: {
                                                    stats: {
                                                        "strength": {flat: 1},
                                                        "dexterity": {flat: 1}, 
                                                    },
                                                },
                                                12: {
                                                    stats: {
                                                        "dexterity": {flat: 2},
                                                    }
                                                },
                                            }
                                         },
                                        max_level_coefficient: 8});

    skills["Daggers"] = new Skill({skill_id: "Daggers",
                                parent_skill: "Weapon mastery",
                                names: {0: "Dagger combat"},
                                category: "Weapon",
                                description: "The looked upon art of fighting (and stabbing) with daggers",
                                get_effect_description: ()=> {
                                    return `Multiplies damage dealt with daggers by ${Math.round(skills["Daggers"].get_coefficient("multiplicative")*1000)/1000}.
Multiplies AP with daggers by ${Math.round((skills["Daggers"].get_coefficient("multiplicative")**0.3333)*1000)/1000}`;
                                },
                                rewards: {
                                    milestones: {
                                        1: {
                                            stats: {
                                                "dexterity": {flat: 1},
                                            }
                                        },
                                        3: {
                                            stats: {
                                                "agility": {flat: 1},
                                            }
                                        },
                                        5: {
                                            stats: {
                                                "crit_multiplier": {flat: 0.1},
                                                "crit_rate": {flat: 0.01},
                                            },
                                        },
                                        7: {
                                            stats: {
                                                "dexterity": {flat: 1},
                                            }
                                        },
                                        10: {
                                            stats: {
                                                "crit_rate": {flat: 0.02},
                                                "crit_multiplier": {flat: 0.1}, 
                                            },
                                        },
                                        12: {
                                            stats: {
                                                "dexterity": {flat: 2},
                                            }
                                        },
                                    }
                                 },
                                max_level_coefficient: 8});
								
skills["Unarmed"] = new Skill({skill_id: "Unarmed", 
                                    names: {0: "Unarmed", 10: "Brawling", 20: "Martial arts"}, 
                                    description: "It's definitely, unquestionably, undoubtedly better to just use a weapon instead of doing this. But sure, why not?",
                                    category: "Weapon",
                                    get_effect_description: ()=> {
                                        return `Multiplies damage dealt in unarmed combat by ${Math.round(skills["Unarmed"].get_coefficient("multiplicative")*1000)/1000}. 
Multiplies attack speed and AP in unarmed combat by ${Math.round((skills["Unarmed"].get_coefficient("multiplicative")**0.3333)*1000)/1000}`;
                                    },
                                    max_level_coefficient: 64, //even with 8x more it's still gonna be worse than just using a weapon lol
                                    rewards: {
                                        milestones: {
                                            2: {
                                                stats: {
                                                    "strength": {flat: 1},
                                                },
                                                xp_multipliers: {
                                                    Weightlifting: 1.05,
                                                }
                                            },
                                            4: {
                                                stats: {
                                                    "strength": {flat: 1},
                                                    "dexterity": {flat: 1},
                                                }
                                            },
                                            6: {
                                                stats: {
                                                    "strength": {flat: 1},
                                                    "dexterity": {flat: 1},
                                                    "agility": {flat: 1},
                                                },
                                                xp_multipliers: {
                                                    Weightlifting: 1.1,
                                                }
                                            },
                                            8: {
                                                stats: {
                                                    "strength": {flat: 1},
                                                    "dexterity": {flat: 1},
                                                    "agility": {flat: 1},
                                                }
                                            },
                                            10: {
                                                stats: {
                                                    "strength": {flat: 2},
                                                    "dexterity": {flat: 1},
                                                    "agility": {flat: 1},
                                                },
                                                xp_multipliers: {
                                                    Running: 1.2,
                                                }
                                            },
                                            12: {
                                                stats: {
                                                    "strength": {flat: 2},
                                                    "dexterity": {flat: 2},
                                                    "agility": {flat: 2},
                                                }
                                            },
                                        }
                                    }});								

    skills["Wands"] = new Skill({skill_id: "Wands", 
                                parent_skill: "Weapon mastery",
                                names: {0: "Wand casting"}, 
                                category: "Weapon",
                                description: "Ability to cast spells with magic wands, increases damage dealt", 
                                get_effect_description: ()=> {
                                    return `Multiplies damage dealt with wands by ${Math.round(skills["Wands"].get_coefficient("multiplicative")*1000)/1000}`;
                                },
                                max_level_coefficient: 8});

    skills["Staffs"] = new Skill({skill_id: "Staffs", 
                                parent_skill: "Weapon mastery",
                                names: {0: "Staff casting"}, 
                                category: "Weapon",
                                description: "Ability to cast spells with magic staffs, increases damage dealt", 
                                get_effect_description: ()=> {
                                    return `Multiplies damage dealth with staffs by ${Math.round(skills["Staffs"].get_coefficient("multiplicative")*1000)/1000}`;
                                },
                                max_level_coefficient: 8});
})();



//non-work activity related
(function(){
    skills["Sleeping"] = new Skill({skill_id: "Sleeping",
                                    names: {0: "Recovery"}, 
                                    description: "Good, regular sleep is the basis of getting stronger and helps your body heal.",
                                    base_xp_cost: 1000,
                                    visibility_treshold: 300,
                                    xp_scaling: 2,
                                    category: "Activity",
                                    max_level: 20,
                                    max_level_coefficient: 5,    
                                    rewards: {
                                        milestones: {
                                            2: {
                                                stats: {
                                                    "max_health": {
                                                        flat: 10,
                                                        multiplier: 1.05,
                                                    }
                                                },
                                                xp_multipliers: {
                                                    all: 1.05,
                                                }
                                            },
                                            4: {
                                                stats: {
                                                    "max_health": {
                                                        flat: 20,
                                                        multiplier: 1.05,
                                                    }
                                                },
                                                xp_multipliers: {
                                                    all: 1.05,
                                                },
                                            },
                                            5: {
                                                unlocks: {
                                                    skills: [
                                                        "Meditation"
                                                    ]
                                                }
                                            },
                                            6: {
                                                stats: {
                                                    "max_health": {
                                                        flat: 30,
                                                        multiplier: 1.05,
                                                    }
                                                },
                                                xp_multipliers: {
                                                    all: 1.05,
                                                    "Meditation": 1.1,
                                                }
                                            },
                                            8: {
                                                stats: {
                                                    "max_health": {
                                                        flat: 40,
                                                        multiplier: 1.05,
                                                    }
                                                },
                                                xp_multipliers: {
                                                    all: 1.05,
                                                }
                                            },
                                            10: {
                                                stats: {
                                                    "max_health": {
                                                        flat: 50,
                                                        multiplier: 1.1,
                                                    }
                                                },
                                                xp_multipliers: {
                                                    all: 1.1,
                                                    "Meditation": 1.1,
                                                }
                                            }
                                        }
                                    }
                                });
    skills["Meditation"] = new Skill({skill_id: "Meditation",
                                names: {0: "Meditation"}, 
                                description: "Focus your mind",
                                base_xp_cost: 200,
                                category: "Activity",
                                max_level: 30, 
								max_level_coefficient: 2,
                                is_unlocked: false,
                                visibility_treshold: 0,
                                rewards: {
                                    milestones: {
                                        2: {
                                            stats: {
                                                "intuition": {flat: 1},
                                            },
                                            xp_multipliers: {
                                                all: 1.05,
                                                "Presence sensing": 1.05,
                                            }
                                        },
                                        4: {
                                            stats: {
                                                "intuition": {
                                                    flat: 1, 
                                                    multiplier: 1.05
                                                }
                                            },
                                            xp_multipliers: {
                                                all: 1.05,
                                            }
                                        },
                                        5: {
                                            xp_multipliers: {
                                                "Sleeping": 1.1,
                                                "Presence sensing": 1.05,
                                            }
                                        },
                                        6: {
                                            stats: {
                                                "intuition": {
                                                    flat: 2,
                                                }
                                            },
                                        },
                                        8: {
                                            stats: {
                                                "intuition": {
                                                    multiplier: 1.05
                                                },
                                            },
                                            xp_multipliers: {
                                                all: 1.05,
                                                "Sleeping": 1.1,
                                                "Presence sensing": 1.05,
                                            }
                                        },
                                        10: {
											unlocks: {
                                                skills: [
                                                   "Mana Expansion"
                                                    ]
                                                },
                                            stats: {
                                                "intuition": {
                                                    flat: 2,
                                                    multiplier: 1.05
                                                }
                                            },
                                            xp_multipliers: {
                                                all: 1.1,
                                                "Sleeping": 1.1,
                                                "Presence sensing": 1.1,
                                            }
                                        }
                                    }
                                },
								    get_effect_description: ()=> {
							  let value = skills["Meditation"].get_coefficient("multiplicative");
							  if(value >= 100) {
								  value = Math.round(value);
							  } else if(value >= 10 && value < 100) {
								  value = Math.round(value*10)/10; 
							  } else {
								  value = Math.round(value*100)/100;
							  }
							  return `Multiplies intuition by ${value}`;
							},
                            });                            
    skills["Running"] = new Skill({skill_id: "Running",
                                  description: "Great way to improve the efficiency of the body",
                                  names: {0: "Athletics"},
                                  max_level: 50,
                                  category: "Activity",
                                  max_level_coefficient: 2,
                                  base_xp_cost: 50,
                                  rewards: {
                                    milestones: {
                                        1: {
                                            stats: {
                                                agility: {
                                                    flat: 1
                                                },
                                            }
                                        },
                                        3: {
                                            stats: {
                                                agility: {
                                                    flat: 1
                                                },
                                            }
                                        },
                                        5: {
                                            stats: {
                                                agility: {
                                                    flat: 1,
                                                },
                                                max_stamina: {
                                                    multiplier: 1.05,
                                                }
                                            },                                          
                                        },
                                        7: {
                                            stats: {
                                                agility: {
                                                    flat: 1,
                                                    multiplier: 1.05,
                                                }
                                            },
                                        },
                                        10: {
                                            stats: {
                                                agility: {
                                                    flat: 1,
                                                    multiplier: 1.05,
                                                },
                                                max_stamina: {
                                                    multiplier: 1.05,
                                                }
                                            },
                                        },
                                        12: {
                                            stats: {
                                                agility: {
                                                    flat: 2
                                                },
                                                max_stamina: {
                                                    flat: 5
                                                }
                                            },
                                        }
                                    }
                                  },
                                  get_effect_description: ()=> {
                                    let value = skills["Running"].get_coefficient("multiplicative");
                                    if(value >= 100) {
                                        value = Math.round(value);
                                    } else if(value >= 10 && value < 100) {
                                        value = Math.round(value*10)/10; 
                                    } else {
                                        value = Math.round(value*100)/100;
                                    }
                                    return `Multiplies stamina efficiency by ${value}`;
                                  },
                                  
                                });
    skills["Weightlifting"] = new Skill({skill_id: "Weightlifting",
    description: "No better way to get stronger than by lifting heavy things",
    names: {0: "Strength Training"},
    max_level: 50,
    category: "Activity",
    max_level_coefficient: 4,
    base_xp_cost: 50,
    rewards: {
      milestones: {
          1: {
              stats: {
                strength: {
                    flat: 1
                },
              },
          },
          3: {
              stats: {
                strength: {
                    flat: 1
                },
              },
              xp_multipliers: {
                "Unarmed": 1.05,
              }
          },
          5: {
              stats: {
                strength: {
                    flat: 1,
                    multiplier: 1.05,
                },
                max_stamina: {
                    multiplier: 1.05,
                }
              },
          },
          7: {
              stats: {
                strength: {
                    flat: 1
                },
              },
              xp_multipliers: {
                "Unarmed": 1.1,
              }
          },
          10: {
              stats: {
                  strength: {
                    flat: 1, 
                    multiplier: 1.05
                },
                max_stamina: {
                    multiplier: 1.05,
                }
              },
          },
          12: {
            stats: {
                strength: {
                    flat: 2
                },
                max_stamina: {
                    flat: 5
                }
            }
          }
      }
    },
    get_effect_description: ()=> {
      let value = skills["Weightlifting"].get_coefficient("multiplicative");
      if(value >= 100) {
          value = Math.round(value);
      } else if(value >= 10 && value < 100) {
          value = Math.round(value*10)/10; 
      } else {
          value = Math.round(value*100)/100;
      }
      return `Multiplies strength by ${value}`;
    },
    
    });
    skills["Equilibrium"] = new Skill({skill_id: "Equilibrium",
    description: "Nothing will throw you off your balance (at least the physical one)",
    names: {0: "Equilibrium"},
    category: "Activity",
    max_level: 50,
    max_level_coefficient: 4,
    base_xp_cost: 50,
    rewards: {
      milestones: {
          1: {
              stats: {
                agility: {flat: 1},
              },
          },
          3: {
              stats: {
                intuition: {flat: 1},
              }
          },
          5: {
              stats: {
                agility: {
                    flat: 1,
                    multiplier: 1.05,
                },
                strength: {flat: 1},
                max_stamina: {multiplier: 1.05},
              },
              xp_multipliers: {
                "Unarmed": 1.1,
              }
          },
          7: {
              stats: {
                intuition: {flat: 1},
              },
          },
          9: {
            stats: {
                strength: {flat: 1},
            }
          },
          10: {
              stats: {
                agility: {flat: 1},
                intuition: {multiplier: 1.05},
                max_stamina: {multiplier: 1.05},
              },
          },
          12: {
            stats: {
                agility: {flat: 1},
                strength: {flat: 1},
            }
          }
      }
    },
    get_effect_description: ()=> {
      let value = skills["Equilibrium"].get_coefficient("multiplicative");
      if(value >= 100) {
          value = Math.round(value);
      } else if(value >= 10 && value < 100) {
          value = Math.round(value*10)/10; 
      } else {
          value = Math.round(value*100)/100;
      }
      return `Multiplies agility and dexterity by ${value}`;
    },
    
    });
	
 skills["Breathing"] = new Skill({
        skill_id: "Breathing",
        names: {0: "Breathing"},
        description: "Oxygen is the most important resource for improving the performance of your body. Learn how to take it in more efficiently.",
        flavour_text: "You are now breathing manually",
        base_xp_cost: 300,
        visibility_treshold: 290,
        xp_scaling: 1.6,
        category: "Character",
        max_level_coefficient: 2,
        max_level: 40,
		rewards: {
        milestones: {
            3: {
                xp_multipliers: {
                    Running: 1.1,
                    Meditation: 1.1,
                },
                stats: {
                    attack_speed: {
                        multiplier: 1.02,
                    }
                }
            },
            5: {
                stats: {
                    agility: {
                        multiplier: 1.05,
                    },
                    stamina_efficiency: {
                        multiplier: 1.05,
                    }
                },
            },
            7: {
                xp_multipliers: {
                    Running: 1.1,
                    Meditation: 1.1,
                }
            },
            10: {
                stats: {
                    strength: {
                        multiplier: 1.05
                    },
                    max_stamina: {
                        multiplier: 1.05,
                    },
                    attack_speed: {
                        multiplier: 1.02,
                    }
                },
            },
            12: {
                stats: {
                    strength: {
                        flat: 2
                    },
                    agility: {
                        flat: 2
                    }
                },
                xp_multipliers: {
                    Running: 1.1,
                    Meditation: 1.1,
                }
            }, 
            14: {
                xp_multipliers: {
                    Running: 1.1,
                    Meditation: 1.1,
                },
                stats: {
                    attack_speed: {
                        multiplier: 1.03,
                    },
                    stamina_efficiency: {
                        multiplier: 1.05,
                    }
                }
            }
        },
		},
		get_effect_description: ()=> {
                                    return `Multiplies strength, agility and stamina by ${Math.round(skills["Breathing"].get_coefficient("multiplicative")*1000)/1000}<br>
									Reduces environmental penalty in thin air areas by ${Math.round((1-((1-(skills["Breathing"].current_level/skills["Breathing"].max_level))))*1000)/10}%`;
        },
    });  
	
	skills["Climbing"] = new Skill({skill_id: "Climbing",
        description: "Intense and slightly dangerous form of training that involves majority of your muscles",
        names: {0: "Climbing"},
        max_level: 50,
        category: "Activity",
        max_level_coefficient: 2,
        base_xp_cost: 50,
		rewards: {
        milestones: {
            1: {
                stats: {
                    agility: {
                        flat: 1
                    },
                },
            },
            3: {
                stats: {
                    strength: {
                        flat: 1
                    },
                },
            },
            5: {
                stats: {
                    agility: {
                        multiplier: 1.05,
                    },
                    max_stamina: {
                        multiplier: 1.03,
                    }
                },
            },
            7: {
                stats: {
                    strength: {
                        flat: 1
                    },
                },
            },
            10: {
                stats: {
                    strength: {
                        multiplier: 1.05
                    },
                    max_stamina: {
                        multiplier: 1.03,
                    }
                },
            },
            12: {
                stats: {
                    strength: {
                        flat: 2
                    },
                    agility: {
                        flat: 2
                    }
                }
            }
        },
	
		},
			get_effect_description: ()=> {
                                    return `Multiplies strength, agility and dexterity by ${Math.round(skills["Climbing"].get_coefficient("multiplicative")*1000)/1000}`;
        },
    });
	
	skills["Swimming"] = new Skill({skill_id: "Swimming",
        description: "Master the art of not drowning",
        names: {0: "Swimming"},
        max_level: 50,
        category: "Activity",
        max_level_coefficient: 2,
        base_xp_cost: 50,
		rewards: {
        milestones: {
            1: {
                stats: {
                    agility: {
                        flat: 1
                    },
                },
            },
            3: {
                stats: {
                    strength: {
                        flat: 1
                    },
                },
            },
            5: {
                stats: {
                    agility: {
                        multiplier: 1.05,
                    },
                    max_stamina: {
                        multiplier: 1.03,
                    }
                },
            },
            7: {
                stats: {
                    strength: {
                        flat: 1
                    },
                },
            },
            10: {
                stats: {
                    strength: {
                        multiplier: 1.05
                    },
                    max_stamina: {
                        multiplier: 1.03,
                    }
                },
            },
            12: {
                stats: {
                    strength: {
                        flat: 2
                    },
                    agility: {
                        flat: 2
                    }
                }
            }
        },
	
		},
			get_effect_description: ()=> {
                                    return `Multiplies strength, agility and stamina by ${Math.round(skills["Climbing"].get_coefficient("multiplicative")*1000)/1000}`;
        },
    });

})();

//resource gathering related
(function(){
    skills["Woodcutting"] = new Skill({skill_id: "Woodcutting", 
        names: {0: "Woodcutting"}, 
        description: "Get better with chopping the wood",
        category: "Profession",
        base_xp_cost: 10,
        visibility_treshold: 4,
        xp_scaling: 1.4,
    });

    skills["Mining"] = new Skill({skill_id: "Mining",
        names: {0: "Mining"}, 
        description: "Get better with mining the ores",
        category: "Profession",
        base_xp_cost: 10,
        visibility_treshold: 4,
        xp_scaling: 1.4,
    });
	
    skills["Fishing"] = new Skill({skill_id: "Fishing",
        names: {0: "Fishing"}, 
        description: "Get better at fishing",
        category: "Profession",
        base_xp_cost: 10,
        visibility_treshold: 4,
        xp_scaling: 1.4,
    });

    skills["Herbalism"] = new Skill({skill_id: "Herbalism",
        names: {0: "Herbalism"}, 
        description: "Knowledge of useful plants and mushrooms",
        category: "Profession",
        base_xp_cost: 10,
        visibility_treshold: 4,
        xp_scaling: 1.4,
    });

    skills["Animal handling"] = new Skill({
        skill_id: "Animal handling",
        names: {0: "Animal handling"}, 
        description: "Knowledge and skills required to deal with a wide variety of animals",
        category: "Profession",
        base_xp_cost: 10,
        visibility_treshold: 4,
        xp_scaling: 1.4,
    });
})();

//work related
(function(){
    skills["Farming"] = new Skill({skill_id: "Farming", 
                                names: {0: "Farming"}, 
                                description: "Even a simple action of plowing some fields, can be performed better with skills and experience",
                                base_xp_cost: 40,
                                category: "Profession",
                                max_level: 10,
                                xp_scaling: 1.6,
                                max_level_coefficient: 2,
                                rewards: {
                                    milestones: {
                                        1: {
                                            stats: {
                                                max_stamina: {flat: 2},
                                            },
                                        },
                                        2: {
                                            stats: {
                                                strength: {flat: 1}
                                            },
                                        },
                                        3: {
                                            stats: {
                                                dexterity: {flat: 1},
                                                max_stamina: {flat: 2},
                                            }
                                        },
                                        4: {
                                            stats: {
                                                strength: {flat: 1},
                                                max_stamina: {flat: 2},
                                            }
                                        },
                                        5: {
                                            stats: {
                                                strength: {flat: 1},
                                                max_stamina: {flat: 2},
                                            },
                                            xp_multipliers: {
                                                "Herbalism": 1.05,
                                            }
                                        },
                                        6: {
                                            stats: {
                                                strength: {flat: 1},
                                            },
                                            xp_multipliers: {
                                                Weightlifting: 1.1,
                                            }
                                        },
                                        7: {
                                            stats: {
                                                dexterity: {flat: 1},
                                                max_stamina: {flat: 2},
                                            },
                                            xp_multipliers: {
                                                "Unarmed": 1.05,
                                            }
                                        },
                                        8: {
                                            stats: {
                                                strength: {flat: 1},
                                                max_stamina: {flat: 2},
                                            }
                                        },
                                        9: {
                                            stats: {
                                                strength: {flat: 1},
                                                dexterity: {flat: 1},
                                            },
                                        },
                                        10: {
                                            stats: {
                                                max_stamina: {flat: 4},
                                                strength: {multiplier: 1.05},
                                                dexterity: {multiplier: 1.05},
                                            },
                                            xp_multipliers: {
                                                "Unarmed": 1.1,
                                                "Herbalism": 1.1,
                                            }
                                        }
                                    },
									get_effect_description: ()=> {
                                    return `Improves reward from fieldwork activity`;
                                },
                                }});
	    skills["Foraging"] = new Skill({skill_id: "Foraging", 
                                names: {0: "Foraging"}, 
                                description: "A deep understanding of flora allows you to farm and forage more efficiently.",
                                base_xp_cost: 100,
                                category: "Profession",
                                max_level: 30,
                                xp_scaling: 2,
								base_xp_cost: 100,
								max_level_coefficient: 2,
								visibility_treshold: 1,
								get_effect_description: ()=> {
                                    return `Retains all Farming bonuses<br>${Math.round((skills["Foraging"].get_coefficient("flat")-1)*1000)/10}% chance for +1 resource harvest when herb gathering`;
                                },
	});	

	    skills["Tool Mastery"] = new Skill({skill_id: "Tool Mastery", 
                                names: {0: "Tool Mastery"}, 
                                description: "Expertise with heavy .",
                                base_xp_cost: 100,
                                category: "Profession",
                                max_level: 30,
                                xp_scaling: 2,
								base_xp_cost: 100,
								max_level_coefficient: 1.5,
								visibility_treshold: 1,
								get_effect_description: ()=> {
                                    return `${Math.round((skills["Tool Mastery"].get_coefficient("flat")-1)*1000)/10}% chance for +1 resource harvest when mining ores or cutting trees`;
                                },
	});	

    skills["Salvaging"] = new Skill({skill_id: "Salvaging", 
                                names: {0: "Salvaging"}, 
                                description: "Salvaging",
                                base_xp_cost: 100,
                                category: "Profession",
                                max_level: 10,
                                xp_scaling: 1.8,
                                max_level_coefficient: 2,
								get_effect_description: ()=> {
                                    return `Multiplies droprate by ${Math.round(skills["Salvaging"].get_coefficient("multiplicative")*1000)/1000}`;
                                },
	});		
	    skills["Scrap Mechanic"] = new Skill({skill_id: "Scrap Mechanic", 
                                names: {0: "Scrap Mechanic"}, 
                                description: "Scrap Mechanic",
                                base_xp_cost: 100,
                                category: "Profession",
								is_unlocked: true,
                                max_level: 30,
                                xp_scaling: 2,
								base_xp_cost: 100,
                                max_level_coefficient: 10,
								visibility_treshold: 1,
								get_effect_description: ()=> {
                                    return `Multiplies droprate by ${Math.round(skills["Salvaging"].get_coefficient("multiplicative")*1000)/1000}
									<br> Multiplies crafting XP gain by ${Math.round(skills["Scrap Mechanic"].get_coefficient("multiplicative")*1000)/1000}`;
                                },
	});	



    skills["Lockpicking"] = new Skill({skill_id: "Lockpicking", 
                                names: {0: "Lockpicking"}, 
                                description: "Improves your ability to pick locks",
                                base_xp_cost: 50,
                                category: "Character",
                                max_level: 30,
                                xp_scaling: 1.6,
                                max_level_coefficient: 2,
								get_effect_description: ()=> {
                                    return `Increases ability to pick locks`;
                                },
	});		
								
})();

//crafting skills
(function(){
    skills["Crafting"] = new Skill({
        skill_id: "Crafting", 
        names: {0: "Crafting"}, 
        description: "The art of preparing different elements and assembling them together",
        category: "Profession",
        base_xp_cost: 40,
        xp_scaling: 1.5,
        max_level: 60,
    });
    skills["Smelting"] = new Skill({
        skill_id: "Smelting", 
        names: {0: "Smelting"}, 
        description: "Turning raw ore into raw metal",
        category: "Profession",
        base_xp_cost: 40,
        xp_scaling: 1.5,
        max_level: 60,
    });
    skills["Forging"] = new Skill({
        skill_id: "Forging", 
        names: {0: "Forging"}, 
        description: "Turning raw metal into something useful",
        category: "Profession",
        base_xp_cost: 40,
        xp_scaling: 1.5,
        max_level: 60,
    });
    skills["Cooking"] = new Skill({
        skill_id: "Cooking", 
        names: {0: "Cooking"}, 
        description: "Making the unedible edible",
        category: "Profession",
        base_xp_cost: 40,
        xp_scaling: 1.5,
        max_level: 60,
    });
    skills["Alchemy"] = new Skill({
        skill_id: "Alchemy", 
        names: {0: "Alchemy"}, 
        description: "Extracting and enhancing useful properties of the ingredies",
        category: "Profession",
        base_xp_cost: 40,
        xp_scaling: 1.5,
        max_level: 60,
    });
})();

//defensive skills
(function(){
    skills["Iron skin"] = new Skill({
        skill_id: "Iron skin",
        category: "Combat",
        names: {0: "Tough skin", 5: "Wooden skin", 10: "Iron skin"},
        description: "As it gets damaged, your skin regenerates to be tougher and tougher",
        base_xp_cost: 400,
        xp_scaling: 1.9,
        max_level: 30,
        max_level_bonus: 30,
        get_effect_description: ()=> {
            return `Increases base defense by ${Math.round(skills["Iron skin"].get_level_bonus())}`;
        },
        rewards: {
            milestones: {
                3: {
                    stats: {
                        max_health: {multiplier: 1.01},
                    }
                },
                5: {
                    stats: {
                        max_health: {multiplier: 1.01},
                    }
                },
                7: {
                    stats: {
                        max_health: {multiplier: 1.02},
                    }
                },
                10: {
                    stats: {
                        max_health: {multiplier: 1.02},
                    }
                },
                12: {
                    stats: {
                        max_health: {multiplier: 1.02},
                    }
                }
            }
        }
    }); 
})();

//character skills and resistances
(function(){
    skills["Persistence"] = new Skill({
        skill_id: "Persistence",
        names: {0: "Persistence"},
        description: "Being tired is not a reason to give up",
        base_xp_cost: 60,
        category: "Character",
        max_level: 30,
        get_effect_description: ()=> {
            return `Increases low stamina stat multiplier to x${(50+Math.round(skills["Persistence"].get_level_bonus()*100000)/1000)/100} (originally x0.5)`;
        },
        rewards: {
            milestones: {
                2: {
                    stats: {
                        max_stamina: {flat: 5},
                    },
                    xp_multipliers: {
                        all_skill: 1.05,
                    }
                },
                4: {
                    stats: {
                        max_stamina: {flat: 5},
                    },
                    xp_multipliers: {
                        hero: 1.05,
                    }
                },
                6: {
                    stats: {
                        max_stamina: {flat: 10},
                    },
                    xp_multipliers: {
                        all: 1.05,
                    }
                },
                8: {
                    stats: {
                        max_stamina: {flat: 10},
                    },
                    xp_multipliers: {
                        all: 1.05,
                    }
                },
                10: {
                    stats: {
                        max_stamina: {flat: 10},
                    },
                    xp_multipliers: {
                        all: 1.05,
                    }
                },
				25: {
                    stats: {
                        stamina_regeneration_flat: {flat:1},
                    }
                }

            }
        },
        max_level_bonus: 0.3
    });
    skills["Perception"] = new Skill({
        skill_id: "Perception", 
        names: {0: "Perception"}, 
        description: "Better grasp on your senses allows you to notice small and hidden things, as well as to discern the true nature of what you obsere",
        
        category: "Character",max_level_coefficient: 2,
        get_effect_description: ()=> {
            return ``;
        },
        rewards: {
            milestones: {
                //todo when skill is in use somewhere
            }
        }
    }); 
    skills["Literacy"] = new Skill({
        skill_id: "Literacy", 
        names: {0: "Literacy"}, 
        description: "Ability to read and understand written text",
        category: "Character",
        base_xp_cost: 120,
        max_level: 10,
        xp_scaling: 2,
        get_effect_description: ()=> {
            return `Allows reading harder books`;
        },
        rewards: {
            milestones: {
                1: {
                    xp_multipliers: {
                        hero: 1.05,
                    }
                },
                2: {
                    xp_multipliers: {
                        all_skill: 1.05,
                    }
                },
                5: {
                    xp_multipliers: {
                        hero: 1.10,
                    }
                },
                10: {
                    xp_multipliers: {
                        all_skill: 1.10,
                    }
                }
            }
        }
    }); 
    skills["Medicine"] = new Skill({
        skill_id: "Medicine",
        names: {0: "Medicine"}, 
        description: "Create better medicaments and improve your skill at treating wounds.",
        category: "Character",
        max_level: 30,
        visibility_treshold: 5,
        max_level_coefficient: 2,
        get_effect_description: ()=> {
            let value = get_total_skill_coefficient({skill_id:"Medicine",scaling_type:"multiplicative"});
            return `Multiplies additive effects of medicines by ${Math.round((value**2)*100)/100} and multiplicative effects by ${Math.round(value*100)/100}`;
          },
    });	

})();

//miscellaneous skills
(function(){
    skills["Haggling"] = new Skill({
        skill_id: "Haggling",
        names: {0: "Haggling"},
        description: "The art of the deal",
        category: "Character",
        base_xp_cost: 100,
        max_level: 25,
        get_effect_description: ()=> {
            return `Lowers trader cost multiplier to ${Math.round((1 - skills["Haggling"].get_level_bonus())*100)}% of original value`;
        },
        max_level_bonus: 0.5
    });
    
})();

(function(){
    skills["Gluttony"] = new Skill({
        skill_id: "Gluttony",
        names: {0: "Gluttony"},
        description: "You are HUGE. That means you have HUGE GUTS",
        category: "Character",
        base_xp_cost: 100,
        max_level: 25,
		max_level_bonus: 250,
		rewards: {
		      milestones: {
          5: {
                    stats: {
                        max_health: {multiplier: 1.05},
                    }
              },
          10: {
                    stats: {
                        max_health: {multiplier: 1.10},
                    }
              },
          20: {
                    stats: {
                        max_health: {multiplier: 1.20},
                    }
              },
          25: {
                    stats: {
                        max_health: {multiplier: 1.25},
                    }
              },
			  
          },
		},
		get_effect_description: ()=> {
            return `Increases base max health by ${Math.round(skills["Gluttony"].get_level_bonus())}`;
        },
    });
    
})();

(function(){
    skills["Resilience"] = new Skill({
        skill_id: "Resilience",
        names: {0: "Resilience"},
        description: "Resilience",
        category: "Combat",
        base_xp_cost: 100,
        max_level: 30,
		max_level_bonus: 30,
		get_effect_description: ()=> {
            return `Below 50% HP increases base defense by ${Math.round(skills["Resilience"].get_level_bonus())}`;
        },
    });
    
})();

(function(){
    skills["Last Stand"] = new Skill({
        skill_id: "Last Stand",
        names: {0: "Last Stand"},
        description: "Last Stand",
        category: "Combat",
        base_xp_cost: 30,
        max_level: 30,
		max_level_bonus: 30,
		get_effect_description: ()=> {
            return `Below 10% HP increases base strength by ${Math.round(skills["Last Stand"].get_level_bonus())}`;
        },
    });
    
})();



(function(){
   skills["Leadership"] = new Skill({skill_id: "Leadership", 
                                names: {0: "Leadership"}, 
                                description: "Leadership", 
                                category: "Combat",
								max_level: 10,
								max_level_bonus: 50,
								max_level_coefficient: 10, 
								xp_scaling: 5,
								is_unlocked: true,
									get_effect_description: ()=> {
										return `Multiplies atly attack power and AP by ${Math.round(skills["Leadership"].get_coefficient("multiplicative")*1000)/1000}`;
								},
								                                  rewards: {
                                    milestones: {
                                        1: {
                                            stats: {
                                                intuition: {
                                                    flat: 1
                                                },
                                            },
											              xp_multipliers: {
														"Haggling": 1.10,
											}
                                        },
                                        3: {
                                            stats: {
                                                intuition: {
                                                    flat: 2
                                                },
                                            }
                                        },
                                        5: {
                                            stats: {
                                                intuition: {
                                                    flat: 2,
                                                }
                                            },                                          
                                        },
                                        7: {
                                            stats: {
                                                magic: {
                                                    flat: 1,
                                                    multiplier: 1.05,
                                                }
                                            },
                                        },
                                        10: {
                                            stats: {
                                                intuition: {
                                                    flat: 1,
                                                    multiplier: 1.05,
                                                }
                                            },
                                        },
                                    }
                                  },
	});	
})();




(function(){
   skills["Criticality"] = new Skill({skill_id: "Criticality", 
                                names: {0: "Criticality"}, 
                                description: "Criticality", 
                                category: "Combat",
								max_level_bonus: 0.3,
								base_xp_cost: 100,
								get_effect_description: ()=> {
										return `Increases crit rate by ${skills["Criticality"].get_level_bonus().toPrecision(3)}`;
								},
								
	});	
})();

(function(){
   skills["Obliteration"] = new Skill({skill_id: "Obliteration", 
                                names: {0: "Obliteration"}, 
                                description: "Obliteration", 
                                category: "Combat",
								base_xp_cost: 100,
								max_level_bonus: 1,
								get_effect_description: ()=> {
										return `Increases crit multiplier by ${skills["Obliteration"].get_level_bonus().toPrecision(3)}`;
								},
								
	});	


   skills["Deadliness"] = new Skill({skill_id: "Deadliness", 
                                names: {0: "Deadliness"}, 
                                description: "The ability to deliver lethal strikes and inflict maximum damage.", 
                                category: "Combat",
								base_xp_cost: 100,
								max_level_bonus: 1,
								get_effect_description: ()=> {
										return `Increases crit rate by ${skills["Criticality"].get_level_bonus().toPrecision(3)}
										<br>Increases crit multiplier by ${skills["Obliteration"].get_level_bonus().toPrecision(3)}`;
								},
								rewards: {
        milestones: {
            15: {
                stats: {
					"crit_rate": {flat: 0.01},
                },
            },
			     25: {
                stats: {
					"crit_rate": {flat: 0.02},
                },
            },
		}
								}
								
	});	
})();


(function(){
   skills["Mana Expansion"] = new Skill({skill_id: "Mana Expansion", 
                                names: {0: "Mana Expansion"}, 
                                description: "Mana Expansion", 
                                category: "Magic",
								max_level: 100,
								max_level_bonus: 100,
								xp_scaling: 1.4,
								visibility_treshold: 50,
								is_unlocked: false,
								get_effect_description: ()=> {
										return `Increases Mana by ${skills["Mana Expansion"].get_level_bonus()}`;
								},
	});	
})();

(function(){
    skills["Mana Control"] = new Skill({skill_id: "Mana Control",
                                  description: "Mana Control",
                                  names: {0: "Mana Control", 40: "Mana Mastery" },
                                  max_level: 50,
                                  category: "Magic",
                                  max_level_coefficient: 2,
                                  base_xp_cost: 50,
                                  rewards: {
                                    milestones: {
                                        1: {
                                            stats: {
                                                intuition: {
                                                    flat: 1
                                                },
                                            }
                                        },
                                        3: {
                                            stats: {
                                                intuition: {
                                                    flat: 1
                                                },
                                            }
                                        },
                                        5: {
                                            stats: {
                                                intuition: {
                                                    flat: 1,
                                                }
                                            },                                          
                                        },
                                        7: {
                                            stats: {
                                                magic: {
                                                    flat: 1,
                                                    multiplier: 1.05,
                                                }
                                            },
                                        },
                                        10: {
                                            stats: {
                                                intuition: {
                                                    flat: 1,
                                                    multiplier: 1.05,
                                                }
                                            },
                                        },
                                        25: {
                                            stats: {
                                                magic: {
                                                    flat: 2
                                                },
                                                mana_regeneration_flat: {
                                                    flat: 1
                                                }
                                            },
                                        }
                                    }
                                  },
                                  get_effect_description: ()=> {
                                    let value = skills["Mana Control"].get_coefficient("multiplicative");
                                    if(value >= 100) {
                                        value = Math.round(value);
                                    } else if(value >= 10 && value < 100) {
                                        value = Math.round(value*10)/10; 
                                    } else {
                                        value = Math.round(value*100)/100;
                                    }
                                    return `Multiplies mana efficiency by ${value}`;
                                  },
                                  
                                });
})();

(function(){
   skills["Chronomancy"] = new Skill({skill_id: "Chronomancy", 
                                names: {0: "Chronomancy"}, 
                                description: "Chronomancy", 
                                category: "Magic",
								max_level: 30,
								max_level_bonus: 50,
								max_level_coefficient: 2, 
								xp_scaling: 2,
								is_unlocked: true,
								get_effect_description: ()=> {
										return `Reduces gathering times by ${skills["Chronomancy"].get_level_bonus().toPrecision(3)}%\n\nMultiplies Chronomancy magic effects by ${Math.round(skills["Chronomancy"].get_coefficient("multiplicative")*1000)/1000}`;
								},
	});	
	
   skills["MultiCasting"] = new Skill({skill_id: "MultiCasting", 
                                names: {0: "MultiCasting"}, 
                                description: "MultiCasting", 
                                category: "Magic",
								max_level: 7,
								max_level_bonus: 7,
								xp_scaling: 4,
								is_unlocked: true,
								get_effect_description: ()=> {
										return `Increase max number of targets for combat magics by ${skills["MultiCasting"].get_level_bonus()}`;
								},
	});	
	
   skills["Rapid Casting"] = new Skill({skill_id: "Rapid Casting", 
                                names: {0: "Rapid Casting"}, 
                                description: "Rapid Casting", 
                                category: "Magic",
								max_level: 30,
								xp_scaling: 2,
								max_level_coefficient:3,
								is_unlocked: true,
								get_effect_description: () => {
									const reduction = 100 * (1 - skills["Rapid Casting"].get_coefficient("reverse_multiplicative"));
									return `Reduces magic cooldowns by ${Math.round(reduction * 10) / 10}%`;
								}
							});	

   skills["Spatial Magic"] = new Skill({skill_id: "Spatial Magic", 
                                names: {0: "Spatial Magic"}, 
                                description: "Spatial Magic", 
                                category: "Magic",
								max_level: 10,
								max_level_bonus: 50,
								max_level_coefficient: 2, 
								xp_scaling: 10,
								is_unlocked: true,
								get_effect_description: ()=> {
										return ``;
								},
	});	
	
   skills["Pyromancy"] = new Skill({skill_id: "Pyromancy", 
                                names: {0: "Pyromancy"}, 
                                description: "Pyromancy", 
                                category: "Magic",
								max_level: 30,
								max_level_coefficient: 2, 
								xp_scaling: 2,
								is_unlocked: true,
								get_effect_description: ()=> {
										return `Multiplies Pyromancy magic damage by ${Math.round(skills["Pyromancy"].get_coefficient("multiplicative")*1000)/1000}`;
								},
	});
	
   skills["Electromancy"] = new Skill({skill_id: "Electromancy", 
                                names: {0: "Electromancy"}, 
                                description: "Electromancy", 
                                category: "Magic",
								max_level: 30,
								max_level_coefficient: 2, 
								xp_scaling: 2,
								is_unlocked: true,
								get_effect_description: ()=> {
										return `Multiplies Electromancy magic damage by ${Math.round(skills["Electromancy"].get_coefficient("multiplicative")*1000)/1000}`;
								},
	});
   skills["Cryomancy"] = new Skill({skill_id: "Cryomancy", 
                                names: {0: "Cryomancy"}, 
                                description: "Cryomancy", 
                                category: "Magic",
								max_level: 30,
								max_level_coefficient: 2, 
								xp_scaling: 2,
								is_unlocked: true,
								get_effect_description: ()=> {
										return `Multiplies Cryomancy magic damage by ${Math.round(skills["Cryomancy"].get_coefficient("multiplicative")*1000)/1000}`;
								},
	});
	
   skills["Elemental Mastery"] = new Skill({skill_id: "Elemental Mastery", 
                                names: {0: "Elemental Mastery"}, 
                                description: "Elemental Mastery", 
                                category: "Magic",
								max_level: 30,
								max_level_coefficient: 2, 
								xp_scaling: 2,
								is_unlocked: true,
								get_effect_description: ()=> {
										return `Multiplies Cryomancy, Pyromancy and Electromancy magic damage by ${Math.round(skills["Cryomancy"].get_coefficient("multiplicative")*1000)/1000}`;
								},
	});
   skills["Enhancement"] = new Skill({skill_id: "Enhancement", 
                                names: {0: "Enhancement"}, 
                                description: "Enhancement", 
                                category: "Magic",
								max_level: 30,
								max_level_coefficient: 2, 
								xp_scaling: 2,
								is_unlocked: true,
								get_effect_description: ()=> {
										return `Multiplies Enhancement magic effects by ${Math.round(skills["Enhancement"].get_coefficient("multiplicative")*1000)/1000}`;
								},
	});
   skills["Barrier Magic"] = new Skill({skill_id: "Barrier Magic", 
                                names: {0: "Barrier Magic"}, 
                                description: "Barrier Magic", 
                                category: "Magic",
								max_level: 30,
								max_level_coefficient: 2, 
								xp_scaling: 2,
								is_unlocked: true,
								get_effect_description: ()=> {
										return `Multiplies Barrier magic effects by ${Math.round(skills["Barrier Magic"].get_coefficient("multiplicative")*1000)/1000}`;
								},
	});	
   skills["Magic Extension"] = new Skill({skill_id: "Magic Extension", 
                                names: {0: "Magic Extension"}, 
                                description: "Magic Extension", 
                                category: "Magic",
								max_level: 30,
								max_level_coefficient: 2, 
								xp_scaling: 2,
								is_unlocked: true,
								get_effect_description: ()=> {
										return `Multiplies magic effect durations by ${Math.round(skills["Magic Extension"].get_coefficient("multiplicative")*1000)/1000}`;
								},
	});
	
   skills["Magic Convergence"] = new Skill({skill_id: "Magic Convergence", 
                                names: {0: "Magic Convergence"}, 
                                description: "Magic Convergence", 
                                category: "Magic",
								max_level: 30,
								max_level_coefficient: 2, 
								xp_scaling: 2,
								is_unlocked: true,
								get_effect_description: ()=> {
									const reduction = 100 * (1 - skills["Rapid Casting"].get_coefficient("reverse_multiplicative"));
									 
										return `Reduces magic cooldowns by ${Math.round(reduction * 10) / 10}% <br> Multiplies magic effect durations by ${Math.round(skills["Magic Extension"].get_coefficient("multiplicative")*1000)/1000}`;
								},
	});
   skills["Illusion Magic"] = new Skill({skill_id: "Illusion Magic", 
                                names: {0: "Illusion Magic"}, 
                                description: "Illusion Magic", 
                                category: "Magic",
								max_level: 30,
								max_level_coefficient: 2, 
								xp_scaling: 2,
								is_unlocked: true,
								get_effect_description: ()=> {
										return `Multiplies illusion magic effects by ${Math.round(skills["Illusion Magic"].get_coefficient("multiplicative")*1000)/1000}`;
								},
	});
   skills["Summoning"] = new Skill({skill_id: "Summoning", 
                                names: {0: "Summoning"}, 
                                description: "Summoning", 
                                category: "Magic",
								max_level: 30,
								max_level_coefficient: 2, 
								xp_scaling: 2,
								is_unlocked: true,
								get_effect_description: ()=> {
										return `Multiplies summoning magic effects by ${Math.round(skills["Summoning"].get_coefficient("multiplicative")*1000)/1000}`;
								},
	});	
   skills["Necromancy"] = new Skill({skill_id: "Necromancy", 
                                names: {0: "Necromancy"}, 
                                description: "Necromancy", 
                                category: "Magic",
								max_level: 30,
								max_level_coefficient: 2, 
								xp_scaling: 2,
								is_unlocked: true,
								get_effect_description: ()=> {
										return `Improves effect of Necromancy spells by ${Math.round(skills["Necromancy"].get_coefficient("multiplicative")*1000)/1000}`;
								},
	});	
   skills["Enchantment"] = new Skill({skill_id: "Enchantment", 
                                names: {0: "Enchantment"}, 
                                description: "Enchantment", 
                                category: "Magic",
								max_level: 30,
								max_level_coefficient: 2, 
								xp_scaling: 2,
								is_unlocked: true,
								get_effect_description: ()=> {
										return `Multiplies enchantment magic effects by ${Math.round(skills["Enchantment"].get_coefficient("multiplicative")*1000)/1000}`;
								},
	});	
   skills["Recovery Magic"] = new Skill({skill_id: "Recovery Magic", 
                                names: {0: "Recovery Magic"}, 
                                description: "Recovery Magic", 
                                category: "Magic",
								max_level: 30,
								max_level_coefficient: 2, 
								xp_scaling: 2,
								is_unlocked: true,
								get_effect_description: ()=> {
										return `Multiplies recovery magic effects by ${Math.round(skills["Recovery Magic"].get_coefficient("multiplicative")*1000)/1000}`;
								},
	});	
})();

(function(){
    skills["Magic Mastery"] = new Skill({skill_id: "Magic Mastery", 
                                names: {0: "Magic Mastery"}, 
                                parent_skill: "Stance mastery",
                                description: "Magic Mastery", 
                                max_level_coefficient: 2,
                                base_xp_cost: 60,
                                category: "Stance",
                                max_level: 30,
								max_level_bonus: 30,
                                get_effect_description: ()=> {
                                    return `Improves efficiency of the 'Magic Stance' stance and increases Magic by ${skills["Magic Mastery"].get_level_bonus()}`;
                                }}); 
	    skills["Spellblade Stance Mastery"] = new Skill({skill_id: "Spellblade Stance Mastery", 
                                names: {0: "Spellblade Stance Mastery"}, 
                                parent_skill: "Stance mastery",
                                description: "Spellblade Stance Mastery", 
                                max_level_coefficient: 2,
                                base_xp_cost: 60,
                                category: "Stance",
                                max_level: 30,
								max_level_bonus: 30,
                                get_effect_description: ()=> {
                                    return `Improves efficiency of the 'Spellblade Stance Mastery' stance and increases Magic by ${skills["Spellblade Stance Mastery"].get_level_bonus()}`;
                                }}); 
	    skills["Archmage Stance Mastery"] = new Skill({skill_id: "Archmage Stance Mastery", 
                                names: {0: "Archmage Stance Mastery"}, 
                                parent_skill: "Stance mastery",
                                description: "Archmage Stance Mastery", 
                                max_level_coefficient: 2,
                                base_xp_cost: 100,
                                category: "Stance",
                                max_level: 30,
								max_level_bonus: 100,
                                get_effect_description: ()=> {
                                    return `Improves efficiency of the 'Archmage Stance Mastery' stance and increases Magic by ${skills["Archmage Stance Mastery"].get_level_bonus()}`;
                                }}); 
        
})();        

(function(){
    skills["Magic Potency"] = new Skill({skill_id: "Magic Potency", 
                                names: {0: "Magic Potency"}, 
                                category: "Magic",
                                description: "Magic Potency", 
                                max_level_coefficient: 2,
                                base_xp_cost: 60,
                                get_effect_description: ()=> {
                                    return `Multiplies magic by ${Math.round(skills["Magic Potency"].get_coefficient("multiplicative")*1000)/1000}`;
                                }});
})();

(function(){
    skills["Precision"] = new Skill({skill_id: "Precision",
    description: "Precision",
    names: {0: "Precision"},
    max_level: 50,
    category: "Activity",
    max_level_coefficient: 10,
    base_xp_cost: 50,
    rewards: {
      milestones: {
          1: {
              stats: {
                strength: {
                    flat: 1
                },
              },
          },
          3: {
              stats: {
                strength: {
                    flat: 1
                },
              },
              xp_multipliers: {
                "Unarmed": 1.05,
              }
          },
          5: {
              stats: {
                strength: {
                    flat: 1,
                    multiplier: 1.05,
                },
                max_stamina: {
                    multiplier: 1.05,
                }
              },
          },
          7: {
              stats: {
                strength: {
                    flat: 1
                },
              },
              xp_multipliers: {
                "Unarmed": 1.1,
              }
          },
          10: {
              stats: {
                  strength: {
                    flat: 1, 
                    multiplier: 1.05
                },
                max_stamina: {
                    multiplier: 1.05,
                }
              },
          },
          12: {
            stats: {
                strength: {
                    flat: 2
                },
                max_stamina: {
                    flat: 5
                }
            }
          }
      }
    },
    get_effect_description: ()=> {
      let value = skills["Precision"].get_coefficient("multiplicative");
      if(value >= 100) {
          value = Math.round(value);
      } else if(value >= 10 && value < 100) {
          value = Math.round(value*10)/10; 
      } else {
          value = Math.round(value*100)/100;
      }
      return `Multiplies AP by ${value}`;
    },
});
})();
                   

(function(){
    skills["Undying"] = new Skill({skill_id: "Undying", 
                                names: {0: "Death Resistance", 15: "Undying"}, 
                                category: "Combat",
                                description: "Close brushes with death have made you hard to kill.", 
                                max_level_coefficient: 2,
                                base_xp_cost: 60,
                                get_effect_description: ()=> {
                                    return `Multiplies max health by ${Math.round(skills["Undying"].get_coefficient("multiplicative")*1000)/1000}`;
                                }});
})();


(function(){
    skills["Destiny Mastery"] = new Skill({skill_id: "Destiny Mastery", 
                                names: {0: "Destiny Mastery"}, 
                                category: "Destiny",
                                description: "The ability to seize your own destiny.", 
                                max_level_coefficient: 10,
                                base_xp_cost: 60,
								xp_scaling: 1.4,
                                get_effect_description: ()=> {
                                    return `Multiplies Hero XP gain by ${Math.round(skills["Destiny Mastery"].get_coefficient("multiplicative")*1000)/1000}`;
                                }});
    skills["Fate Mastery"] = new Skill({skill_id: "Fate Mastery", 
                                names: {0: "Fate Mastery"}, 
                                category: "Destiny",
                                description: "The ability to seize your own fate.", 
                                max_level_coefficient: 100,
                                base_xp_cost: 60,
								xp_scaling: 1.4,
                                get_effect_description: ()=> {
                                    return `Multiplies Skill XP gain by ${Math.round(skills["Fate Mastery"].get_coefficient("multiplicative")*1000)/1000}`;
                                }});
})();

(function(){
    skills["Limit Breaking"] = new Skill({skill_id: "Limit Breaking", 
                                names: {0: "Limit Breaking"}, 
                                category: "Destiny",
                                description: "Defy your own limits", 
                                max_level_bonus: 0.3,
								max_level: 20,
                                base_xp_cost: 60,
								xp_scaling: 1.4,
                                get_effect_description: ()=> {
                                    return `Reduces scaling factor of Hero XP requirements by ${skills["Limit Breaking"].get_level_bonus()}`;
                                }});
})();

(function(){
    skills["Martial Rank"] = new Skill({skill_id: "Martial Rank", 
                                names: {0: "Martial Rank"}, 
                                category: "Advancement",
                                description: "Your martial rank", 
                                base_xp_cost: 100,
								xp_scaling: 10,
                                get_effect_description: ()=> {
                                   return ;
                                }});
    skills["Magic Circle"] = new Skill({skill_id: "Magic Circle", 
                                names: {0: "Magic Circle"}, 
                                category: "Advancement",
                                description: "Your magic circle rank", 
								base_xp_cost: 100,
								xp_scaling: 10,
                                get_effect_description: ()=> {
                                    return ;
                                }});
})();


(function(){
    skills["Dragon Heart"] = new Skill({skill_id: "Dragon Heart", 
                                names: {0: "Dragon Heart"}, 
                                category: "Chimeric",
                                description: "Dragon Heart", 
                                max_level: 5,
                                base_xp_cost: 1,
								xp_scaling: 1.1,
								rewards:
                                {
                                    milestones: {
                                        1:  {
											stats: {
                                                "dexterity": {flat: 10},
												"strength": {flat: 10},
												"agility": {flat: 10},
												"intuition": {flat: 10},
												"max_health": {flat: 50},
                                            },
                                        },
										2:  {
											stats: {
                                                "dexterity": {flat: 10},
												"strength": {flat: 10},
												"agility": {flat: 10},
												"intuition": {flat: 10},
												"max_health": {flat: 50},
                                            },
                                        },
										3:  {
											stats: {
                                                "dexterity": {flat: 10},
												"strength": {flat: 10},
												"agility": {flat: 10},
												"intuition": {flat: 10},
												"max_health": {flat: 50},
                                            },
                                        },
										4:  {
											stats: {
                                                "dexterity": {flat: 10},
												"strength": {flat: 10},
												"agility": {flat: 10},
												"intuition": {flat: 10},
												"max_health": {flat: 50},
                                            },
                                        },
										5:  {
											stats: {
                                                "dexterity": {flat: 10},
												"strength": {flat: 10},
												"agility": {flat: 10},
												"intuition": {flat: 10},
												"max_health": {flat: 50},
												"stamina_regeneration_flat": {flat: 1},
												"mana_regeneration_flat": {flat: 1},
                                            },
                                        },
                                },
								},
                                get_effect_description: ()=> {
                                    return `Draw power from Dragon Hearts`;
                                }});
    skills["Symbiote"] = new Skill({skill_id: "Symbiote", 
                                names: {0: "Symbiote"}, 
                                category: "Chimeric",
                                description: "Symbiote", 
                                max_level: 10,
                                base_xp_cost: 1,
								xp_scaling: 1.1,
									rewards:
                                {
                                    milestones: {
                                        1:  {
											stats: {
                                                "attack_power": {flat: 10},
                                            },
                                        },
										2:  {
											stats: {
													"attack_power": {flat: 10},
                                            },
                                        },
										3:  {
											stats: {
													"attack_power": {flat: 10},
                                            },
                                        },
										4:  {
											stats: {
													"attack_power": {flat: 10},
                                            },
                                        },
										5:  {
											stats: {
													"attack_power": {flat: 10},
													"crit_rate": {flat: 0.01},
                                            },
                                        },
                                        6:  {
											stats: {
                                                "attack_power": {flat: 10},
                                            },
                                        },
										7:  {
											stats: {
													"attack_power": {flat: 10},
                                            },
                                        },
										8:  {
											stats: {
													"attack_power": {flat: 10},
                                            },
                                        },
										9:  {
											stats: {
													"attack_power": {flat: 10},
                                            },
                                        },
										10:  {
											stats: {
													"attack_power": {flat: 10},
													"crit_rate": {flat: 0.01},
													"stamina_regeneration_flat": {flat: 1},
                                            },
                                        },
                                },
								},
                                get_effect_description: ()=> {
                                    return `Draw power from the Symbiote`;
                                }});
})();



(function(){
   skills["Man Slayer"] = new Skill({skill_id: "Man Slayer", 
                                names: {0: "Man Slayer"},
								max_level_coefficient: 1.5,
                                description: "Man Slayer", 
                                category: "Exterminator",
								 get_effect_description: ()=> {
                                    return `Multiplies damage against humanoid enemies by ${Math.round(skills["Man Slayer"].get_coefficient("multiplicative")*1000)/1000}`;
                                }
	});	
   skills["Dragon Slayer"] = new Skill({skill_id: "Dragon Slayer", 
                                names: {0: "Dragon Slayer"},
								max_level_coefficient: 1.5,								
                                description: "Dragon Slayer", 
                                category: "Exterminator",
								get_effect_description: ()=> {
                                    return `Multiplies damage against dragonoid enemies by ${Math.round(skills["Dragon Slayer"].get_coefficient("multiplicative")*1000)/1000}`;
                                }
	});	
   skills["Slime Culler"] = new Skill({skill_id: "Slime Culler", 
                                names: {0: "Slime Culler"},
								max_level_coefficient: 1.5,
                                description: "Slime Culler", 
                                category: "Exterminator",
								get_effect_description: ()=> {
                                    return `Multiplies damage against amorphous enemies by ${Math.round(skills["Slime Culler"].get_coefficient("multiplicative")*1000)/1000}`;
                                }
	});
   skills["Smasher"] = new Skill({skill_id: "Smasher", 
                                names: {0: "Smasher"},
								max_level_coefficient: 1.5,
                                description: "Smasher", 
                                category: "Exterminator",
								get_effect_description: ()=> {
                                    return `Multiplies damage against animated enemies by ${Math.round(skills["Smasher"].get_coefficient("multiplicative")*1000)/1000}`;
                                }
	});	
   skills["Purifier"] = new Skill({skill_id: "Purifier", 
                                names: {0: "Purifier"}, 
                                max_level_coefficient: 1.5,
								description: "Purifier", 
                                category: "Exterminator",
								get_effect_description: ()=> {
                                    return `Multiplies damage against undead enemies by ${Math.round(skills["Purifier"].get_coefficient("multiplicative")*1000)/1000}`;
                                }
	});	
   skills["Exorcist"] = new Skill({skill_id: "Exorcist", 
                                names: {0: "Exorcist"}, 
                                max_level_coefficient: 1.5,
								description: "Exorcist", 
                                category: "Exterminator",
								get_effect_description: ()=> {
                                    return `Multiplies damage against spirit enemies by ${Math.round(skills["Exorcist"].get_coefficient("multiplicative")*1000)/1000}`;
                                }
	});
   skills["Hunter"] = new Skill({skill_id: "Hunter", 
                                names: {0: "Hunter"}, 
                                max_level_coefficient: 1.5,
								description: "Hunter", 
                                category: "Exterminator",
								get_effect_description: ()=> {
                                    return `Multiplies damage against beast enemies by ${Math.round(skills["Hunter"].get_coefficient("multiplicative")*1000)/1000}`;
                                }
	});
   skills["Monster Hunter"] = new Skill({skill_id: "Monster Hunter", 
                                names: {0: "Monster Hunter"}, 
                                max_level_coefficient: 1.5,
								description: "Monster Hunter", 
                                category: "Exterminator",
								get_effect_description: ()=> {
                                    return `Multiplies damage against monster enemies by ${Math.round(skills["Monster Hunter"].get_coefficient("multiplicative")*1000)/1000}`;
                                }
	});	
   skills["Exterminator"] = new Skill({skill_id: "Exterminator", 
                                names: {0: "Exterminator"}, 
                                max_level_coefficient: 1.5,
								description: "Exterminator", 
                                category: "Exterminator",
								get_effect_description: ()=> {
                                    return `Multiplies damage against arthropod enemies by ${Math.round(skills["Exterminator"].get_coefficient("multiplicative")*1000)/1000}`;
                                }
	});
   skills["Defroster"] = new Skill({skill_id: "Defroster", 
                                names: {0: "Defroster"}, 
                                max_level_coefficient: 1.5,
								description: "Defroster", 
                                category: "Exterminator",
								get_effect_description: ()=> {
                                    return `Multiplies damage against ice enemies by ${Math.round(skills["Defroster"].get_coefficient("multiplicative")*1000)/1000}`;
                                }
	});
   skills["Extinguisher"] = new Skill({skill_id: "Extinguisher", 
                                names: {0: "Extinguisher"}, 
                                max_level_coefficient: 1.5,
								description: "Extinguisher", 
                                category: "Exterminator",
								get_effect_description: ()=> {
                                    return `Multiplies damage against fire enemies by ${Math.round(skills["Extinguisher"].get_coefficient("multiplicative")*1000)/1000}`;
                                }
	});
})();



export {skills, get_unlocked_skill_rewards, get_next_skill_milestone, weapon_type_to_skill, which_skills_affect_skill};