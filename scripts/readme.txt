--- CONJOBS ---

export VISUAL=nano

0 */6 * * * /home/bscgas/scripts/backup_database_keys.sh
0 3 * * 1 /home/bscgas/scripts/backup_database_requests.sh
0 2 * * * /home/bscgas/scripts/backup_database_history.sh