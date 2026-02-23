import yaml
import os
import re

# ==============================================================================
# JULES SCHEDULE SYNCHRONIZER - Driven by jules_config.yml
# ==============================================================================

CONFIG_PATH = "jules_config.yml"
WORKFLOW_DIR = ".github/workflows"

# Offset Roma (CET = UTC+1). 
ROME_UTC_OFFSET = 1 

def rome_to_utc_cron(time_str):
    """Converte HH:MM (Roma) in cron string '0 H * * *' (UTC)"""
    try:
        hour, minute = map(int, time_str.split(':'))
        # Calcolo ora UTC
        utc_hour = (hour - ROME_UTC_OFFSET) % 24
        return f"0 {utc_hour} * * *"
    except Exception as e:
        print(f"ERROR parsing time '{time_str}': {e}")
        return None

def update_workflow(filename, cron_string):
    """Aggiorna la riga cron nel workflow specificato"""
    path = os.path.join(WORKFLOW_DIR, filename)
    if not os.path.exists(path):
        print(f"WARNING: Workflow not found: {path}")
        return

    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Regex per trovare la riga cron sotto schedule
    # Cerca: - cron: '...'
    new_content = re.sub(
        r"(schedule:\s+-\s+cron:\s+['\"])([^'\"]+)(['\"])",
        lambda m: f"{m.group(1)}{cron_string}{m.group(3)}",
        content
    )

    if content != new_content:
        with open(path, 'w', encoding='utf-8') as f:
            f.write(new_content)
        print(f"SUCCESS: Updated {filename} -> {cron_string}")
    else:
        print(f"INFO: {filename} already synced.")

def main():
    if not os.path.exists(CONFIG_PATH):
        print("ERROR: Config file not found!")
        return

    with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
        config = yaml.safe_load(f)

    schedules = config.get('schedules', {})
    
    # Mapping tra chiavi config e file workflow
    mapping = {
        'setup_sync_time': ['master-setup.yml'],
        'master_controller_time': ['controller.yml']
    }

    for config_key, workflows in mapping.items():
        rome_time = schedules.get(config_key)
        if not rome_time:
            continue
        
        cron_utc = rome_to_utc_cron(rome_time)
        if cron_utc:
            for wf in workflows:
                update_workflow(wf, cron_utc)

if __name__ == "__main__":
    main()
