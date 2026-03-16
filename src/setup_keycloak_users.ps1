param(
    [string]$adminUser = "admin",
    [string]$adminPass = "admin"
)

Write-Host "Logging into Keycloak Admin..."
docker exec wims-keycloak /opt/keycloak/bin/kcadm.sh config credentials --server http://localhost:8080/auth --realm master --user $adminUser --password $adminPass

Write-Host "Creating Admin User..."
docker exec wims-keycloak /opt/keycloak/bin/kcadm.sh create users -r bfp -s id=a0eebc99-9c0b-4ef8-bb6d-6bb9bd380004 -s username=admin_nhq -s enabled=true -s email=admin_nhq@bfp.gov.ph
docker exec wims-keycloak /opt/keycloak/bin/kcadm.sh set-password -r bfp --username admin_nhq --new-password password123
docker exec wims-keycloak /opt/keycloak/bin/kcadm.sh add-roles -r bfp --uusername admin_nhq --rolename ADMIN

Write-Host "Creating Analyst User..."
docker exec wims-keycloak /opt/keycloak/bin/kcadm.sh create users -r bfp -s id=a0eebc99-9c0b-4ef8-bb6d-6bb9bd380003 -s username=analyst_nhq -s enabled=true -s email=analyst_nhq@bfp.gov.ph
docker exec wims-keycloak /opt/keycloak/bin/kcadm.sh set-password -r bfp --username analyst_nhq --new-password password123
docker exec wims-keycloak /opt/keycloak/bin/kcadm.sh add-roles -r bfp --uusername analyst_nhq --rolename ANALYST

Write-Host "Creating Validator User..."
docker exec wims-keycloak /opt/keycloak/bin/kcadm.sh create users -r bfp -s id=0231f88d-a873-46e2-91d5-8b48de9eb8d9 -s username=validator_ncr -s enabled=true -s email=validator_ncr@bfp.gov.ph
docker exec wims-keycloak /opt/keycloak/bin/kcadm.sh set-password -r bfp --username validator_ncr --new-password password123
docker exec wims-keycloak /opt/keycloak/bin/kcadm.sh add-roles -r bfp --uusername validator_ncr --rolename VALIDATOR

Write-Host "Creating Encoder User..."
docker exec wims-keycloak /opt/keycloak/bin/kcadm.sh create users -r bfp -s id=ac90c0e1-a5a6-4332-bab1-d817cc484243 -s username=encoder_ncr -s enabled=true -s email=encoder_ncr@bfp.gov.ph
docker exec wims-keycloak /opt/keycloak/bin/kcadm.sh set-password -r bfp --username encoder_ncr --new-password password123
docker exec wims-keycloak /opt/keycloak/bin/kcadm.sh add-roles -r bfp --uusername encoder_ncr --rolename ENCODER

Write-Host "Done! You can now log into Keycloak with any of the accounts using password 'password123'." 
